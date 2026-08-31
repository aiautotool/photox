import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JoseAccessTokenService } from '@photox/auth-jose';
import { LocalFileDeliveryAdapter } from '@photox/media-delivery-node';
import { SqlitePhotoXStore, SqliteJobRepository } from '@photox/persistence-sqlite';

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
    const firstStore = new SqlitePhotoXStore({ path });
    const firstRepo = new SqliteJobRepository(firstStore);
    await firstRepo.put({
      id: 'job-1', type: 'video.thumbnail.generate', payload: { assetId: 'asset-1' }, state: 'QUEUED', priority: 10,
      attempts: 0, maxAttempts: 5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), checkpoint: { step: 'queued' },
    });
    firstStore.close();

    const secondStore = new SqlitePhotoXStore({ path });
    const secondRepo = new SqliteJobRepository(secondStore);
    const restored = await secondRepo.get('job-1');
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
