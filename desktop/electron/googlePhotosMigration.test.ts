import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { OAuth2Client } from 'google-auth-library';
import type { GooglePhotosMigrationLedger, MigrationTransferCheckpoint, PickedMediaItem } from '@photosync/google-photos';
import { DesktopGooglePhotosMigrationService, verifyDriveMigrationCheckpoint } from './googlePhotosMigration.js';

function fakeOauthClient(): OAuth2Client {
  const client: any = {
    credentials: {},
    setCredentials(tokens: unknown) { this.credentials = tokens; },
    async getAccessToken() { return { token: 'test-access-token' }; },
  };
  return client as OAuth2Client;
}

function service(accountsDir: string, workspaceId: string) {
  return new DesktopGooglePhotosMigrationService({
    accountsDir,
    workspaceId,
    legacyWorkspaceId: 'legacy-personal',
    oauthClient: () => fakeOauthClient(),
    openExternal: async () => undefined,
    ledger: {} as GooglePhotosMigrationLedger,
    uploadToDrive: async () => { throw new Error('UNEXPECTED_DRIVE_UPLOAD'); },
  });
}

async function writeAccount(accountsDir: string, filename: string, input: { id: string; email: string; workspaceId?: string }) {
  await fs.writeFile(path.join(accountsDir, filename), JSON.stringify({
    ...input,
    tokens: { access_token: `token-${input.id}` },
    capabilities: ['picker'],
    updatedAt: '2026-09-03T00:00:00.000Z',
  }, null, 2));
}

test('Google Photos credential files stay isolated by workspace and foreign remove is rejected', async (t) => {
  const accountsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-google-photos-'));
  t.after(async () => fs.rm(accountsDir, { recursive: true, force: true }));

  await writeAccount(accountsDir, 'workspace-a.json', { id: 'account-a', email: 'a@example.com', workspaceId: 'workspace-a' });
  await writeAccount(accountsDir, 'workspace-b.json', { id: 'account-b', email: 'b@example.com', workspaceId: 'workspace-b' });
  await writeAccount(accountsDir, 'legacy.json', { id: 'legacy-account', email: 'legacy@example.com' });

  const workspaceB = service(accountsDir, 'workspace-b');
  assert.deepEqual((await workspaceB.listAccounts()).map(account => account.id), ['account-b']);

  await assert.rejects(() => workspaceB.removeAccount('account-a'), /GOOGLE_PHOTOS_ACCOUNT_NOT_FOUND/);
  await fs.access(path.join(accountsDir, 'workspace-a.json'));
  await fs.access(path.join(accountsDir, 'legacy.json'));
});

test('only the designated legacy workspace may claim unscoped Google Photos credentials', async (t) => {
  const accountsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-google-photos-legacy-'));
  t.after(async () => fs.rm(accountsDir, { recursive: true, force: true }));

  await writeAccount(accountsDir, 'foreign.json', { id: 'foreign-account', email: 'foreign@example.com', workspaceId: 'workspace-a' });
  await writeAccount(accountsDir, 'legacy.json', { id: 'legacy-account', email: 'legacy@example.com' });

  const nonLegacy = service(accountsDir, 'workspace-b');
  assert.deepEqual(await nonLegacy.listAccounts(), []);
  await fs.access(path.join(accountsDir, 'legacy.json'));

  const legacy = service(accountsDir, 'legacy-personal');
  assert.deepEqual((await legacy.listAccounts()).map(account => account.id), ['legacy-account']);
  await assert.rejects(() => fs.access(path.join(accountsDir, 'legacy.json')), /ENOENT/);

  const migratedFiles = await fs.readdir(accountsDir);
  const migratedPayloads = await Promise.all(migratedFiles.map(async filename => JSON.parse(await fs.readFile(path.join(accountsDir, filename), 'utf8'))));
  const migrated = migratedPayloads.find(payload => payload.id === 'legacy-account');
  assert.equal(migrated?.workspaceId, 'legacy-personal');
  assert.equal(migratedPayloads.some(payload => payload.id === 'foreign-account' && payload.workspaceId === 'legacy-personal'), false);
});

test('Drive migration verification reuses the durable completed checkpoint instead of starting a new upload', async () => {
  const source: PickedMediaItem = { id: 'picker-media-1', mediaFile: { filename: 'IMG_0001.JPG', mimeType: 'image/jpeg', baseUrl: 'https://picker.invalid/session-bound' } };
  const checkpoint: MigrationTransferCheckpoint = {
    kind: 'google_drive_resumable_v1',
    accountId: 'drive-account-1',
    sessionUri: 'https://upload.invalid/session-1',
    nextByte: 321,
    totalBytes: 321,
    targetId: 'drive-file-1',
    updatedAt: '2026-09-05T04:00:00.000Z',
  };
  let calls = 0;
  let receivedCheckpoint: MigrationTransferCheckpoint | undefined;
  const result = await verifyDriveMigrationCheckpoint({
    accountId: 'drive-account-1',
    source,
    response: new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '321' } }),
    checkpoint,
    targetId: 'drive-file-1',
    uploadToDrive: async input => {
      calls += 1;
      receivedCheckpoint = input.checkpoint;
      assert.equal(input.accountId, 'drive-account-1');
      assert.equal(input.source.id, 'picker-media-1');
      return { targetId: input.checkpoint?.targetId, targetUrl: 'https://drive.invalid/file/drive-file-1' };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(receivedCheckpoint, checkpoint);
  assert.equal(result.targetId, 'drive-file-1');
});

test('Drive migration verification fails closed on missing or mismatched durable target checkpoints', async () => {
  const source: PickedMediaItem = { id: 'picker-media-2', mediaFile: { filename: 'IMG_0002.JPG', mimeType: 'image/jpeg', baseUrl: 'https://picker.invalid/session-bound' } };
  const response = new Response(new Uint8Array([1]), { headers: { 'content-length': '1' } });
  const unexpectedUpload = async () => { throw new Error('verification must reject before provider call'); };

  await assert.rejects(() => verifyDriveMigrationCheckpoint({
    accountId: 'drive-account-1', source, response, checkpoint: null, targetId: 'drive-file-2', uploadToDrive: unexpectedUpload,
  }), /GOOGLE_DRIVE_MIGRATION_VERIFICATION_CHECKPOINT_MISSING/);

  const mismatched: MigrationTransferCheckpoint = {
    kind: 'google_drive_resumable_v1', accountId: 'drive-account-1', sessionUri: 'https://upload.invalid/session-2', nextByte: 1, totalBytes: 1,
    targetId: 'different-drive-file', updatedAt: '2026-09-05T04:00:00.000Z',
  };
  await assert.rejects(() => verifyDriveMigrationCheckpoint({
    accountId: 'drive-account-1', source, response, checkpoint: mismatched, targetId: 'drive-file-2', uploadToDrive: unexpectedUpload,
  }), /GOOGLE_DRIVE_MIGRATION_VERIFICATION_CHECKPOINT_MISSING/);
});

test('Drive migration verification rejects provider target identity changes', async () => {
  const source: PickedMediaItem = { id: 'picker-media-3', mediaFile: { filename: 'VID_0001.MOV', mimeType: 'video/quicktime', baseUrl: 'https://picker.invalid/session-bound' } };
  const checkpoint: MigrationTransferCheckpoint = {
    kind: 'google_drive_resumable_v1', accountId: 'drive-account-2', sessionUri: 'https://upload.invalid/session-3', nextByte: 10, totalBytes: 10,
    targetId: 'drive-file-expected', updatedAt: '2026-09-05T04:00:00.000Z',
  };
  await assert.rejects(() => verifyDriveMigrationCheckpoint({
    accountId: 'drive-account-2', source, response: new Response(new Uint8Array([1]), { headers: { 'content-length': '10' } }), checkpoint,
    targetId: 'drive-file-expected', uploadToDrive: async () => ({ targetId: 'drive-file-other' }),
  }), /GOOGLE_DRIVE_MIGRATION_TARGET_ID_MISMATCH/);
});
