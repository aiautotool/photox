import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JoseAccessTokenService } from '@photox/auth-jose';
import { MediaCloudCatalog, MediaCloudStatsService, MemoryMediaCloudRepository } from '@photox/media-cloud';
import { LocalFileDeliveryAdapter } from '@photox/media-delivery-node';
import { SqlitePhotoXStore, SqliteJobRepository } from '@photox/persistence-sqlite';
import { MemorySecretStore, MemoryTelegramConfigStore, MemoryTelegramMediaRepository, TelegramAccountService, TelegramMediaStatsService } from '@photox/provider-telegram';

test('JOSE access token signs and verifies PhotoX principal', async () => {
  const service = new JoseAccessTokenService({ secret: new Uint8Array(32).fill(7) });
  const issued = await service.issue({ subject: 'device-user', deviceId: 'iphone-1', sessionId: 'session-1', scopes: ['media:read', 'media:download'] }, 60);
  const principal = await service.verify(issued.token);
  assert.equal(principal.subject, 'device-user');
  assert.equal(principal.deviceId, 'iphone-1');
  assert.equal(principal.sessionId, 'session-1');
  assert.deepEqual(principal.scopes, ['media:read', 'media:download']);
  assert.ok((principal.expiresAt ?? 0) > Math.floor(Date.now() / 1000));
});

test('SQLite job repository survives database reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photox-sqlite-'));
  const path = join(dir, 'photox.db');
  try {
    const workspaceId = 'workspace-runtime';
    const firstStore = new SqlitePhotoXStore({ path });
    const firstRepo = new SqliteJobRepository(firstStore, workspaceId, workspaceId);
    await firstRepo.put({
      id: 'job-1', workspaceId, type: 'video.thumbnail.generate', payload: { assetId: 'asset-1' }, state: 'QUEUED', priority: 10,
      attempts: 0, maxAttempts: 5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoint: { step: 'queued' },
    });
    firstStore.close();

    const secondStore = new SqlitePhotoXStore({ path });
    const secondRepo = new SqliteJobRepository(secondStore, workspaceId, workspaceId);
    const restored = await secondRepo.get(workspaceId, 'job-1');
    assert.equal(restored?.workspaceId, workspaceId);
    assert.equal(restored?.state, 'QUEUED');
    assert.equal(restored?.type, 'video.thumbnail.generate');
    assert.deepEqual(restored?.payload, { assetId: 'asset-1' });
    assert.deepEqual(restored?.checkpoint, { step: 'queued' });
    secondStore.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Local delivery adapter returns correct 206 byte range', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photox-range-'));
  const path = join(dir, 'video.bin');
  try {
    await writeFile(path, Buffer.from('0123456789'));
    const adapter = new LocalFileDeliveryAdapter('local');
    const response = await adapter.open({ assetId: 'asset-1', variant: 'original', providerId: 'local', uri: path, mimeType: 'video/mp4', local: true, supportsRange: true, verified: true, health: 'healthy' }, { range: 'bytes=2-5' });
    assert.equal(response.status, 206);
    assert.equal(response.headers?.['content-range'], 'bytes 2-5/10');
    assert.equal(response.headers?.['content-length'], '4');
    const chunks = [];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), '2345');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Media cloud catalog isolates identical asset IDs, replicas, removal and stats by workspace', async () => {
  const repository = new MemoryMediaCloudRepository();
  const workspaceA = new MediaCloudCatalog(repository, 'workspace-a');
  const workspaceB = new MediaCloudCatalog(repository, 'workspace-b');

  await workspaceA.registerAsset({ assetId: 'same-asset', filename: 'a.jpg', sizeBytes: 100 });
  await workspaceB.registerAsset({ assetId: 'same-asset', filename: 'b.jpg', sizeBytes: 200 });
  await workspaceA.attachReplica('same-asset', {
    replicaId: 'replica-a', assetId: 'same-asset', providerId: 'google-drive', accountId: 'account-a', state: 'VERIFIED', sizeBytes: 100,
  });
  await workspaceB.attachReplica('same-asset', {
    replicaId: 'replica-b', assetId: 'same-asset', providerId: 'telegram', accountId: 'account-b', state: 'VERIFIED', sizeBytes: 200,
  });

  const a = await workspaceA.get('same-asset');
  const b = await workspaceB.get('same-asset');
  assert.equal(a?.workspaceId, 'workspace-a');
  assert.equal(a?.filename, 'a.jpg');
  assert.deepEqual(a?.locations.map((row) => row.providerId), ['google-drive']);
  assert.equal(b?.workspaceId, 'workspace-b');
  assert.equal(b?.filename, 'b.jpg');
  assert.deepEqual(b?.locations.map((row) => row.providerId), ['telegram']);

  assert.deepEqual((await workspaceA.list()).map((row) => row.filename), ['a.jpg']);
  assert.deepEqual((await workspaceB.list()).map((row) => row.filename), ['b.jpg']);

  const statsA = await new MediaCloudStatsService(repository, workspaceA, 'workspace-a').snapshot();
  const statsB = await new MediaCloudStatsService(repository, workspaceB, 'workspace-b').snapshot();
  assert.equal(statsA.mediaCount, 1);
  assert.equal(statsA.totalLogicalBytes, 100);
  assert.deepEqual(statsA.providers.map((row) => row.providerId), ['google-drive']);
  assert.equal(statsB.mediaCount, 1);
  assert.equal(statsB.totalLogicalBytes, 200);
  assert.deepEqual(statsB.providers.map((row) => row.providerId), ['telegram']);

  await workspaceA.remove('same-asset');
  assert.equal(await workspaceA.get('same-asset'), null);
  assert.equal((await workspaceB.get('same-asset'))?.filename, 'b.jpg');
});

test('Telegram provider account configs, bot tokens and media stats are isolated by workspace', async () => {
  const configs = new MemoryTelegramConfigStore();
  const secrets = new MemorySecretStore();
  const media = new MemoryTelegramMediaRepository();
  const workspaceA = new TelegramAccountService(configs, secrets, 'workspace-a');
  const workspaceB = new TelegramAccountService(configs, secrets, 'workspace-b');

  await workspaceA.save({ workspaceId: 'workspace-a', accountId: 'shared-account', displayName: 'A Telegram', chatId: '-1001', botTokenSecretKey: 'telegram.bot.shared', enabled: true, apiMode: 'cloud' }, 'token-a');
  await workspaceB.save({ workspaceId: 'workspace-b', accountId: 'shared-account', displayName: 'B Telegram', chatId: '-1002', botTokenSecretKey: 'telegram.bot.shared', enabled: true, apiMode: 'cloud' }, 'token-b');

  assert.deepEqual((await workspaceA.list()).map((row) => row.displayName), ['A Telegram']);
  assert.deepEqual((await workspaceB.list()).map((row) => row.displayName), ['B Telegram']);
  assert.equal((await workspaceA.resolve('shared-account')).botToken, 'token-a');
  assert.equal((await workspaceB.resolve('shared-account')).botToken, 'token-b');
  await assert.rejects(() => workspaceA.save({ workspaceId: 'workspace-b', accountId: 'escape', displayName: 'escape', chatId: '-1', botTokenSecretKey: 'escape', enabled: true, apiMode: 'cloud' }, 'bad'), /TELEGRAM_WORKSPACE_MISMATCH/);

  const baseMedia = { id: 'same-file', accountId: 'shared-account', chatId: '-1001', messageId: 1, fileId: 'same-file', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'image', sizeBytes: 100, sha256: 'abc', storedAt: '2026-09-03T00:00:00.000Z', sourceKey: 'asset-1' };
  await media.add({ ...baseMedia, workspaceId: 'workspace-a' });
  await media.add({ ...baseMedia, workspaceId: 'workspace-b', chatId: '-1002', sizeBytes: 200, sha256: 'def' });

  const statsA = await new TelegramMediaStatsService(media, 'workspace-a').getStats({ 'shared-account': 'A Telegram' });
  const statsB = await new TelegramMediaStatsService(media, 'workspace-b').getStats({ 'shared-account': 'B Telegram' });
  assert.equal(statsA.workspaceId, 'workspace-a');
  assert.equal(statsA.totalMedia, 1);
  assert.equal(statsA.totalBytes, 100);
  assert.equal(statsB.workspaceId, 'workspace-b');
  assert.equal(statsB.totalMedia, 1);
  assert.equal(statsB.totalBytes, 200);

  await workspaceA.remove('shared-account');
  await assert.rejects(() => workspaceA.resolve('shared-account'), /Unknown Telegram account/);
  assert.equal((await workspaceB.resolve('shared-account')).botToken, 'token-b');
  await media.removeByFileId('workspace-a', 'shared-account', 'same-file');
  assert.equal((await media.list('workspace-a')).length, 0);
  assert.equal((await media.list('workspace-b')).length, 1);
});
