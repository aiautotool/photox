import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { OAuth2Client } from 'google-auth-library';
import type { GooglePhotosMigrationLedger } from '@photosync/google-photos';
import { DesktopGooglePhotosMigrationService } from './googlePhotosMigration.js';

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
