import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OAuth2Client } from 'google-auth-library';
import { getDriveFile } from '@photosync/google-drive';
import { applyDriveReplicaProbe, probeDriveReplica, replicaNeedsRemoteVerification } from './driveReplicaHealth.js';
import { applyReplicaHealthPatches, type ReplicaHealthPatch } from './mediaIndexReplicaMerge.js';
import { mutateSerializedJsonArray } from './mediaIndexSerializedStore.js';
import type { SavedDriveAccountRecord } from './driveAccountPolicyStore.js';

const LEGACY_WORKSPACE_ID = process.env.PHOTOX_WORKSPACE_ID || 'legacy-personal';
const DEFAULT_VERIFY_INTERVAL_MS = 15 * 60_000;
const MIN_VERIFY_INTERVAL_MS = 60_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type Replica = {
  state: 'QUEUED'|'UPLOADING'|'VERIFYING'|'VERIFIED'|'UPLOADED'|'BLOCKED'|'ERROR';
  accountId?: string;
  remoteFileId?: string;
  remoteMd5?: string;
  verifiedAt?: string;
  remoteCheckedAt?: string;
  message?: string;
  [key: string]: unknown;
};

type Row = {
  workspaceId?: string;
  key: string;
  path?: string;
  size: number;
  sha256?: string;
  cloud?: Replica;
  cloudReplicas?: Replica[];
  [key: string]: unknown;
};

function configuredIntervalMs() {
  const parsed = Number(process.env.PHOTOX_REPLICA_VERIFY_INTERVAL_MS || DEFAULT_VERIFY_INTERVAL_MS);
  return Number.isFinite(parsed) ? Math.max(MIN_VERIFY_INTERVAL_MS, Math.floor(parsed)) : DEFAULT_VERIFY_INTERVAL_MS;
}

function stateDir() { return path.join(app.getPath('userData'), 'photosync-state'); }
function indexFile() { return path.join(stateDir(), 'media-index.json'); }
function accountsDir() { return path.join(stateDir(), 'google-accounts'); }

function oauthClient() {
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
  return new OAuth2Client(id, secret, 'http://127.0.0.1:53682/oauth2callback');
}

async function loadAccounts(): Promise<SavedDriveAccountRecord[]> {
  await fs.mkdir(accountsDir(), { recursive: true });
  const result: SavedDriveAccountRecord[] = [];
  for (const name of (await fs.readdir(accountsDir())).filter(name => name.endsWith('.json'))) {
    try {
      const account = JSON.parse(await fs.readFile(path.join(accountsDir(), name), 'utf8')) as SavedDriveAccountRecord;
      if (account?.id && account.tokens) result.push(account);
    } catch {}
  }
  return result;
}

/**
 * Merge only replica-health fields into the latest index snapshot through the
 * shared serialized boundary. This prevents the verifier from replacing newer
 * ingestion/video-processing/repair metadata and still retries if a legacy
 * writer changes the file outside the boundary while the mutation is pending.
 */
async function writeReplicaHealthPatches(patches: ReplicaHealthPatch[]) {
  if (!patches.length) return;
  await mutateSerializedJsonArray<Row>(indexFile(), latest => {
    const normalized = latest.map(row => ({ ...row, workspaceId: row.workspaceId || LEGACY_WORKSPACE_ID }));
    const merged = applyReplicaHealthPatches(normalized, patches);
    return merged.applied ? merged.rows : normalized;
  }, { tempLabel: 'replica-health' });
}

async function localMd5(filePath?: string) {
  if (!filePath) return undefined;
  return await new Promise<string | undefined>(resolve => {
    const hash = crypto.createHash('md5');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(undefined));
  });
}

/**
 * Revalidates persisted Drive replicas. Definitive remote missing/integrity
 * failures become ERROR so the existing one-minute repair sweep sees the asset
 * as under-replicated. Transient provider failures retain the last VERIFIED
 * state and are retried after the configured verification interval.
 */
export async function runDriveReplicaRepairSweep(nowMs = Date.now()) {
  let rows: Row[];
  try { rows = JSON.parse(await fs.readFile(indexFile(), 'utf8')) as Row[]; }
  catch { return { checked: 0, degraded: 0, deferred: 0 }; }

  const accounts = await loadAccounts();
  const accountMap = new Map(accounts.map(account => [`${account.workspaceId || LEGACY_WORKSPACE_ID}:${account.id}`, account]));
  const interval = configuredIntervalMs();
  const patches: ReplicaHealthPatch[] = [];
  let checked = 0;
  let degraded = 0;
  let deferred = 0;

  for (const row of rows) {
    const workspaceId = row.workspaceId || LEGACY_WORKSPACE_ID;
    const replicas = row.cloudReplicas?.length ? row.cloudReplicas : row.cloud ? [row.cloud] : [];
    for (const replica of replicas) {
      if (!replicaNeedsRemoteVerification(replica, nowMs, interval)) continue;
      checked += 1;
      const account = accountMap.get(`${workspaceId}:${replica.accountId}`);
      if (!account) {
        patches.push({
          workspaceId,
          key: row.key,
          accountId: replica.accountId,
          remoteFileId: replica.remoteFileId,
          replica: { ...replica, state: 'ERROR', remoteCheckedAt: new Date(nowMs).toISOString(), message: 'DRIVE_REPLICA_ACCOUNT_UNAVAILABLE' },
        });
        degraded += 1;
        continue;
      }

      const expectedMd5 = replica.remoteMd5 || await localMd5(row.path);
      const result = await probeDriveReplica({
        remoteFileId: replica.remoteFileId!,
        expectedSizeBytes: row.size,
        storedMd5: expectedMd5,
        expectedSha256: row.sha256,
        fetchRemote: async remoteFileId => {
          const client = oauthClient();
          client.setCredentials(account.tokens as any);
          const token = await client.getAccessToken();
          if (!token.token) throw new Error('DRIVE_ACCESS_TOKEN_UNAVAILABLE');
          if (JSON.stringify(client.credentials) !== JSON.stringify(account.tokens)) {
            await fs.writeFile(path.join(accountsDir(), `${account.id}.json`), JSON.stringify({ ...account, tokens: client.credentials }, null, 2), { encoding: 'utf8', mode: 0o600 });
          }
          return getDriveFile(token.token, remoteFileId);
        },
        now: () => new Date(nowMs),
      });
      patches.push({
        workspaceId,
        key: row.key,
        accountId: replica.accountId,
        remoteFileId: replica.remoteFileId,
        replica: applyDriveReplicaProbe(replica, result),
      });
      if (result.kind === 'missing' || result.kind === 'mismatch') degraded += 1;
      if (result.kind === 'deferred') deferred += 1;
    }
  }

  await writeReplicaHealthPatches(patches);
  return { checked, degraded, deferred };
}

let timer: NodeJS.Timeout | null = null;
let running = false;
async function scheduledSweep() {
  if (running) return;
  running = true;
  try {
    const result = await runDriveReplicaRepairSweep();
    if (result.degraded) console.warn(`PhotoX Drive replica verification degraded ${result.degraded} replica(s); repair sweep will replenish them.`);
  } catch (error) {
    console.error('PhotoX Drive replica verification sweep failed', error instanceof Error ? error.message : String(error));
  } finally { running = false; }
}

app.whenReady().then(() => {
  const initialDelay = Math.min(30_000, configuredIntervalMs());
  setTimeout(() => void scheduledSweep(), initialDelay);
  timer = setInterval(() => void scheduledSweep(), configuredIntervalMs());
});
app.on('before-quit', () => { if (timer) clearInterval(timer); timer = null; });
