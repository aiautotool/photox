import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { chooseAccount, migrateLegacyWorkspaceRows, type StorageAccount } from '@photosync/core';
import { createResumableUploadSession, ensurePhotoSyncFolder, getDriveFile, getStorageQuota, listPhotoSyncFiles } from '@photosync/google-drive';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { loadWorkspaceDriveAccounts } from './driveAccountPolicyStore.js';
import { driveRuntimeAllocation } from './driveRuntimeAllocation.js';
import { MediaRepairCoordinator } from './mediaRepairCoordinator.js';
import { repairMediaFromPrincipal, type MediaRepairAuditEvent, type MediaRepairPrincipal } from './mediaRepairTransport.js';
import { mimeTypeForFilename } from './mediaProcessing.js';

const LEGACY_WORKSPACE_ID = process.env.PHOTOX_WORKSPACE_ID || 'legacy-personal';
const LEGACY_OWNER_USER_ID = process.env.PHOTOX_OWNER_USER_ID || 'legacy-owner';
const LEGACY_DESKTOP_DEVICE_ID = `desktop_${crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0, 20)}`;
const TARGET_CLOUD_REPLICAS = 2;
const INDEX_WRITE_RETRIES = 5;
const OAUTH_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}/oauth2callback`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RepairReplica = {
  state: 'QUEUED'|'UPLOADING'|'VERIFYING'|'VERIFIED'|'UPLOADED'|'BLOCKED'|'ERROR';
  accountId?: string;
  accountEmail?: string;
  folderId?: string;
  remotePath?: string;
  remoteFileId?: string;
  remoteMd5?: string;
  webViewLink?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  remoteCheckedAt?: string;
  message?: string;
  [key: string]: unknown;
};

type RepairRow = {
  workspaceId?: string;
  key: string;
  filename: string;
  path: string;
  size: number;
  sha256?: string;
  mimeType?: string;
  cloud?: RepairReplica;
  cloudReplicas?: RepairReplica[];
  [key: string]: unknown;
};

type RuntimeDriveAccount = {
  id: string;
  email: string;
  client: OAuth2Client;
  folderId: string;
  storage: StorageAccount;
};

let ipcRegistered = false;
let uploadQueue: Promise<void> = Promise.resolve();

function electronRuntimeAvailable() {
  return Boolean((process.versions as NodeJS.ProcessVersions & { electron?: string }).electron);
}

async function electronApp() {
  const { app } = await import('electron');
  return app;
}

async function paths() {
  const app = await electronApp();
  const stateDir = path.join(app.getPath('userData'), 'photosync-state');
  return {
    stateDir,
    indexFile: path.join(stateDir, 'media-index.json'),
    accountsDir: path.join(stateDir, 'google-accounts'),
    databasePath: path.join(stateDir, 'migration.sqlite'),
  };
}

function replicasOf(row: RepairRow) {
  if (row.cloudReplicas?.length) return row.cloudReplicas;
  return row.cloud ? [row.cloud] : [];
}

function isVerified(replica: RepairReplica) {
  return replica.state === 'VERIFIED' || replica.state === 'UPLOADED';
}

async function readRows(): Promise<RepairRow[]> {
  const resolved = await paths();
  try {
    const raw = JSON.parse(await fs.readFile(resolved.indexFile, 'utf8')) as RepairRow[];
    return migrateLegacyWorkspaceRows(raw as any[], LEGACY_WORKSPACE_ID).rows as RepairRow[];
  } catch {
    return [];
  }
}

async function mutateExactRow(workspaceId: string, key: string, mutate: (row: RepairRow) => RepairRow) {
  const resolved = await paths();
  for (let attempt = 0; attempt < INDEX_WRITE_RETRIES; attempt += 1) {
    const before = await fs.readFile(resolved.indexFile, 'utf8');
    const rows = migrateLegacyWorkspaceRows(JSON.parse(before) as any[], LEGACY_WORKSPACE_ID).rows as RepairRow[];
    const index = rows.findIndex(row => (row.workspaceId || LEGACY_WORKSPACE_ID) === workspaceId && row.key === key);
    if (index < 0) throw new Error('MEDIA_REPAIR_NOT_FOUND');
    rows[index] = { ...mutate({ ...rows[index] }), workspaceId };
    const temp = `${resolved.indexFile}.${process.pid}.${Date.now()}.${attempt}.repair.tmp`;
    await fs.writeFile(temp, JSON.stringify(rows, null, 2), 'utf8');
    const current = await fs.readFile(resolved.indexFile, 'utf8');
    if (current !== before) {
      await fs.rm(temp, { force: true });
      continue;
    }
    await fs.rename(temp, resolved.indexFile);
    return rows[index];
  }
  throw new Error('MEDIA_INDEX_CONCURRENT_WRITE_RETRY_EXHAUSTED');
}

async function oauthClient() {
  const app = await electronApp();
  let id = process.env.PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_ID;
  let secret = process.env.PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_SECRET;
  if (!id || !secret) {
    try {
      const configPath = app.isPackaged ? path.join(process.resourcesPath, 'google-oauth.json') : path.join(__dirname, '../google-oauth.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const installed = config.installed || config.web || {};
      id = installed.client_id;
      secret = installed.client_secret;
    } catch {}
  }
  if (!id || !secret) throw new Error('DRIVE_OAUTH_CONFIGURATION_MISSING');
  return new OAuth2Client(id, secret, REDIRECT_URI);
}

async function runtimeDriveAccounts(workspaceId: string): Promise<RuntimeDriveAccount[]> {
  const resolved = await paths();
  const saved = await loadWorkspaceDriveAccounts(resolved.accountsDir, workspaceId, LEGACY_WORKSPACE_ID);
  const result: RuntimeDriveAccount[] = [];
  for (const account of saved) {
    try {
      const client = await oauthClient();
      client.setCredentials(account.tokens as any);
      const token = await client.getAccessToken();
      if (!token.token) continue;
      if (JSON.stringify(client.credentials) !== JSON.stringify(account.tokens)) {
        await fs.writeFile(path.join(resolved.accountsDir, `${account.id}.json`), JSON.stringify({ ...account, tokens: client.credentials }, null, 2), { encoding: 'utf8', mode: 0o600 });
      }
      const folderId = await ensurePhotoSyncFolder(token.token);
      const [quota, files] = await Promise.all([getStorageQuota(token.token), listPhotoSyncFiles(token.token, folderId)]);
      const appUsedBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
      const allocation = driveRuntimeAllocation({
        account,
        email: account.email || account.id,
        quota: { limit: Number(quota.limit || 0), usage: Number(quota.usage || 0) },
        appUsedBytes,
      });
      result.push({ id: account.id, email: account.email || account.id, client, folderId, storage: allocation.storage });
    } catch (error) {
      console.error('Drive repair account unavailable', account.id, error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

async function saveReplica(workspaceId: string, key: string, replica: RepairReplica) {
  return mutateExactRow(workspaceId, key, row => {
    const replicas = replicasOf(row).filter(existing => !(replica.accountId && existing.accountId === replica.accountId));
    replicas.push(replica);
    return { ...row, cloud: replicas[0], cloudReplicas: replicas };
  });
}

async function uploadExactMedia(workspaceId: string, key: string) {
  const row = (await readRows()).find(item => (item.workspaceId || LEGACY_WORKSPACE_ID) === workspaceId && item.key === key);
  if (!row) throw new Error('MEDIA_REPAIR_NOT_FOUND');
  await fs.access(row.path).catch(() => { throw new Error('MEDIA_REPAIR_LOCAL_ORIGINAL_UNAVAILABLE'); });

  const accounts = await runtimeDriveAccounts(workspaceId);
  if (!accounts.length) {
    await saveReplica(workspaceId, key, { state: 'QUEUED', message: 'Đang chờ tài khoản Google Drive hợp lệ; hệ thống sẽ tự thử lại.' });
    return;
  }

  let latest = row;
  while (new Set(replicasOf(latest).filter(isVerified).map(replica => replica.accountId).filter(Boolean)).size < TARGET_CLOUD_REPLICAS) {
    const verifiedAccounts = new Set(replicasOf(latest).filter(isVerified).map(replica => replica.accountId).filter(Boolean));
    const eligible = accounts.filter(account => !verifiedAccounts.has(account.id));
    const chosenStorage = chooseAccount(eligible.map(account => account.storage), latest.size);
    if (!chosenStorage) {
      await saveReplica(workspaceId, key, {
        state: 'QUEUED',
        message: `Đang chờ tài khoản Drive phù hợp: hiện có ${verifiedAccounts.size}/${TARGET_CLOUD_REPLICAS} bản hợp lệ.`,
      });
      return;
    }

    const account = accounts.find(candidate => candidate.id === chosenStorage.id)!;
    let replica: RepairReplica = {
      state: 'UPLOADING',
      accountId: account.id,
      accountEmail: account.email,
      folderId: account.folderId,
      remotePath: '/PhotoSync/',
    };
    latest = await saveReplica(workspaceId, key, replica);

    try {
      const sourceSha256 = typeof latest.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(latest.sha256) ? latest.sha256 : undefined;
      if (!sourceSha256) throw new Error('MEDIA_REPAIR_SHA256_REQUIRED');
      const token = await account.client.getAccessToken();
      if (!token.token) throw new Error('DRIVE_ACCESS_TOKEN_UNAVAILABLE');
      const mimeType = latest.mimeType || mimeTypeForFilename(latest.filename);
      const session = await createResumableUploadSession(token.token, {
        name: latest.filename,
        mimeType,
        sizeBytes: latest.size,
        folderId: account.folderId,
        appProperties: { photosyncKey: latest.key, photosyncSha256: sourceSha256 },
      });
      const response = await fetch(session, {
        method: 'PUT',
        headers: { 'content-type': mimeType, 'content-length': String(latest.size) },
        body: createReadStream(latest.path) as any,
        duplex: 'half',
      } as any);
      if (!response.ok) throw new Error(`DRIVE_UPLOAD_FAILED:${response.status}`);
      const uploaded = await response.json().catch(() => ({})) as { id?: string };
      if (!uploaded.id) throw new Error('DRIVE_REMOTE_FILE_ID_MISSING');

      const remote = await getDriveFile(token.token, uploaded.id);
      if (Number(remote.size || 0) !== latest.size) throw new Error('DRIVE_REMOTE_SIZE_MISMATCH');
      if (remote.appProperties?.photosyncSha256 !== sourceSha256) throw new Error('DRIVE_REMOTE_SHA256_MISMATCH');

      const now = new Date().toISOString();
      replica = {
        ...replica,
        state: 'VERIFIED',
        remoteFileId: remote.id,
        remoteMd5: remote.md5Checksum,
        webViewLink: remote.webViewLink || `https://drive.google.com/file/d/${remote.id}/view`,
        uploadedAt: now,
        verifiedAt: now,
        remoteCheckedAt: now,
        message: undefined,
      };
      latest = await saveReplica(workspaceId, key, replica);
    } catch (error) {
      replica = { ...replica, state: 'ERROR', message: error instanceof Error ? error.message : String(error) };
      await saveReplica(workspaceId, key, replica);
      return;
    }
  }
}

async function trustedDesktopPrincipal(): Promise<MediaRepairPrincipal> {
  const resolved = await paths();
  const store = new SqlitePhotoXStore({ path: resolved.databasePath });
  const workspaces = new SqliteWorkspaceRepository(store);
  try {
    const membership = workspaces.getMembership(LEGACY_WORKSPACE_ID, LEGACY_OWNER_USER_ID);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    const role = membership.role;
    if (role !== 'owner' && role !== 'admin' && role !== 'member' && role !== 'viewer') throw new Error('MEMBERSHIP_ROLE_INVALID');
    return { subject: LEGACY_OWNER_USER_ID, workspaceId: LEGACY_WORKSPACE_ID, workspaceRole: role, deviceId: LEGACY_DESKTOP_DEVICE_ID };
  } finally {
    store.close();
  }
}

async function appendDesktopAudit(principal: MediaRepairPrincipal, event: MediaRepairAuditEvent) {
  const resolved = await paths();
  const store = new SqlitePhotoXStore({ path: resolved.databasePath });
  const workspaces = new SqliteWorkspaceRepository(store);
  try {
    workspaces.appendAudit({
      workspaceId: principal.workspaceId,
      actorUserId: principal.subject,
      actorDeviceId: principal.deviceId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      metadata: event.metadata,
    });
  } finally {
    store.close();
  }
}

const coordinator = new MediaRepairCoordinator({
  loadMedia: async (workspaceId, key) => {
    const row = (await readRows()).find(item => (item.workspaceId || LEGACY_WORKSPACE_ID) === workspaceId && item.key === key);
    if (!row) return undefined;
    let localAvailable = false;
    try { await fs.access(row.path); localAvailable = true; } catch {}
    return {
      workspaceId,
      key,
      localAvailable,
      verifiedAccountIds: replicasOf(row).filter(isVerified).map(replica => replica.accountId || '').filter(Boolean),
      targetReplicas: TARGET_CLOUD_REPLICAS,
    };
  },
  scheduleUpload: async media => {
    uploadQueue = uploadQueue.then(() => uploadExactMedia(media.workspaceId, media.key)).catch(error => {
      console.error('Exact media repair upload failed', media.key, error instanceof Error ? error.message : String(error));
    });
  },
});

export async function repairMediaForPrincipal(
  principal: MediaRepairPrincipal,
  key: string,
  source: 'desktop' | 'web',
  appendAudit?: (principal: MediaRepairPrincipal, event: MediaRepairAuditEvent) => Promise<void> | void,
) {
  return repairMediaFromPrincipal({ principal, key, coordinator, source, appendAudit });
}

export async function repairMediaForTrustedDesktop(key: string) {
  const principal = await trustedDesktopPrincipal();
  return repairMediaForPrincipal(principal, key, 'desktop', appendDesktopAudit);
}

export async function registerMediaRepairDesktopRuntime() {
  if (ipcRegistered || !electronRuntimeAvailable()) return;
  const { ipcMain } = await import('electron');
  ipcMain.handle('photosync:repair-media', (_event, key: string) => repairMediaForTrustedDesktop(String(key || '')));
  ipcRegistered = true;
}

if (electronRuntimeAvailable()) void registerMediaRepairDesktopRuntime();