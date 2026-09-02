import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import {
  GOOGLE_PHOTOS_APPEND_SCOPE,
  GOOGLE_PHOTOS_PICKER_SCOPE,
  GooglePhotosMigrationRunner,
  createMediaItems,
  createPickingSession,
  deletePickingSession,
  downloadPickedMedia,
  getPickingSession,
  listAllPickedMedia,
  migrationItemsFromPicker,
  uploadPhotoBytes,
  type GooglePhotosMigrationJob,
  type GooglePhotosMigrationLedger,
  type MigrationTarget,
  type PickedMediaItem,
} from '@photosync/google-photos';

export type GooglePhotosCapability = 'picker' | 'append';
export type GooglePhotosAccountInfo = {
  id: string;
  email: string;
  capabilities: GooglePhotosCapability[];
  status: 'ready' | 'unavailable';
};

type SavedGooglePhotosAccount = {
  id: string;
  email: string;
  tokens: Credentials;
  capabilities: GooglePhotosCapability[];
  updatedAt: string;
};

export type MigrationSnapshot = {
  job: GooglePhotosMigrationJob;
  items: Awaited<ReturnType<GooglePhotosMigrationLedger['listItems']>>;
};

export type DriveMigrationDestination = (input: {
  accountId: string;
  source: PickedMediaItem;
  response: Response;
  signal?: AbortSignal;
  onBytes?: (bytes: number) => void;
}) => Promise<{ targetId?: string; targetUrl?: string }>;

export interface DesktopGooglePhotosMigrationOptions {
  accountsDir: string;
  workspaceId: string;
  oauthPort?: number;
  oauthClient: () => OAuth2Client;
  openExternal: (url: string) => Promise<unknown> | unknown;
  ledger: GooglePhotosMigrationLedger;
  uploadToDrive: DriveMigrationDestination;
  onUpdated?: (snapshot: MigrationSnapshot) => void;
}

function stableAccountId(email: string) {
  return `photos-${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 20)}`;
}

function accountFilename(id: string) { return `${id}.json`; }

export class DesktopGooglePhotosMigrationService {
  private readonly oauthPort: number;
  private readonly paused = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly running = new Map<string, Promise<GooglePhotosMigrationJob>>();

  constructor(private readonly options: DesktopGooglePhotosMigrationOptions) {
    this.oauthPort = options.oauthPort ?? 53683;
  }

  async listAccounts(): Promise<GooglePhotosAccountInfo[]> {
    const accounts = await this.savedAccounts();
    const result: GooglePhotosAccountInfo[] = [];
    for (const account of accounts) {
      try {
        await this.accessToken(account);
        result.push({ id: account.id, email: account.email, capabilities: account.capabilities, status: 'ready' });
      } catch {
        result.push({ id: account.id, email: account.email, capabilities: account.capabilities, status: 'unavailable' });
      }
    }
    return result;
  }

  async connectAccount(capability: GooglePhotosCapability): Promise<GooglePhotosAccountInfo> {
    await fs.mkdir(this.options.accountsDir, { recursive: true });
    const client = this.options.oauthClient();
    const redirectUri = `http://127.0.0.1:${this.oauthPort}/oauth2callback`;
    const scopes = [
      capability === 'picker' ? GOOGLE_PHOTOS_PICKER_SCOPE : GOOGLE_PHOTOS_APPEND_SCOPE,
      'openid', 'email', 'profile',
    ];
    const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: true, scope: scopes });
    await this.options.openExternal(url);

    return new Promise<GooglePhotosAccountInfo>((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const incoming = new URL(req.url || '/', redirectUri);
          if (incoming.pathname !== '/oauth2callback') { res.writeHead(404); res.end('Not found'); return; }
          const code = incoming.searchParams.get('code');
          if (!code) throw new Error('GOOGLE_PHOTOS_AUTH_CODE_MISSING');
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          const token = await client.getAccessToken();
          if (!token.token) throw new Error('GOOGLE_PHOTOS_ACCESS_TOKEN_MISSING');
          const info = await client.getTokenInfo(token.token);
          const email = info.email?.toLowerCase();
          if (!email) throw new Error('GOOGLE_PHOTOS_EMAIL_MISSING');
          const id = stableAccountId(email);
          const previous = (await this.savedAccounts()).find(item => item.id === id);
          const mergedTokens: Credentials = {
            ...previous?.tokens,
            ...client.credentials,
            refresh_token: client.credentials.refresh_token || previous?.tokens.refresh_token,
          };
          const capabilities = [...new Set<GooglePhotosCapability>([...(previous?.capabilities ?? []), capability])];
          const saved: SavedGooglePhotosAccount = { id, email, tokens: mergedTokens, capabilities, updatedAt: new Date().toISOString() };
          await fs.writeFile(path.join(this.options.accountsDir, accountFilename(id)), JSON.stringify(saved, null, 2), { encoding: 'utf8', mode: 0o600 });
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<h2>PhotoX đã kết nối Google Photos.</h2><p>Bạn có thể đóng tab này và quay lại PhotoX.</p>');
          server.close();
          resolve({ id, email, capabilities, status: 'ready' });
        } catch (error) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(error instanceof Error ? error.message : String(error));
          server.close();
          reject(error);
        }
      });
      server.once('error', reject);
      server.listen(this.oauthPort, '127.0.0.1');
    });
  }

  async removeAccount(accountId: string) {
    await fs.unlink(path.join(this.options.accountsDir, accountFilename(accountId))).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }

  async createSelection(input: { sourceAccountId: string; target: MigrationTarget; targetAccountId: string; maxItemCount?: number }) {
    const account = await this.requireAccount(input.sourceAccountId, 'picker');
    const token = await this.accessToken(account);
    const session = await createPickingSession(token, input.maxItemCount ?? 2000);
    if (!session.id || !session.pickerUri) throw new Error('GOOGLE_PHOTOS_PICKER_SESSION_INVALID');
    const now = new Date().toISOString();
    const job: GooglePhotosMigrationJob = {
      id: crypto.randomUUID(), workspaceId: this.options.workspaceId, sourceAccountId: account.id,
      sourcePickerSessionId: session.id, target: input.target, targetAccountId: input.targetAccountId,
      state: 'selecting', totalItems: 0, completedItems: 0, failedItems: 0, transferredBytes: 0,
      createdAt: now, updatedAt: now,
    };
    await this.options.ledger.createJob(job);
    await this.options.openExternal(session.pickerUri);
    await this.emit(job.id);
    return { job, pickerUri: session.pickerUri, expireTime: session.expireTime };
  }

  async materializeSelection(jobId: string): Promise<MigrationSnapshot> {
    const job = await this.requireJob(jobId);
    if (!job.sourcePickerSessionId) throw new Error('GOOGLE_PHOTOS_PICKER_SESSION_MISSING');
    const account = await this.requireAccount(job.sourceAccountId, 'picker');
    const token = await this.accessToken(account);
    const session = await getPickingSession(token, job.sourcePickerSessionId);
    if (!session.mediaItemsSet) throw new Error('GOOGLE_PHOTOS_PICKER_NOT_FINISHED');
    const selected = await listAllPickedMedia(token, job.sourcePickerSessionId);
    const items = migrationItemsFromPicker(job.id, selected);
    await this.options.ledger.putItems(items);
    const totalBytes = items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0) || undefined;
    await this.options.ledger.updateJob(job.id, { state: 'queued', totalItems: items.length, totalBytes, updatedAt: new Date().toISOString() });
    return this.emit(job.id);
  }

  async listJobs() { return this.options.ledger.listJobs(this.options.workspaceId); }

  async getSnapshot(jobId: string): Promise<MigrationSnapshot> {
    const job = await this.requireJob(jobId);
    return { job, items: await this.options.ledger.listItems(jobId) };
  }

  pause(jobId: string) { this.paused.add(jobId); }
  cancel(jobId: string) { this.cancelled.add(jobId); }

  async resume(jobId: string) {
    this.paused.delete(jobId);
    this.cancelled.delete(jobId);
    return this.run(jobId);
  }

  async retryFailed(jobId: string) {
    const items = await this.options.ledger.listItems(jobId);
    const updatedAt = new Date().toISOString();
    for (const item of items.filter(item => item.state === 'failed')) {
      await this.options.ledger.updateItem(item.id, { state: 'queued', error: undefined, transferredBytes: 0, updatedAt });
    }
    await this.options.ledger.updateJob(jobId, { state: 'queued', failedItems: 0, completedAt: undefined, lastError: undefined, updatedAt });
    return this.resume(jobId);
  }

  run(jobId: string): Promise<GooglePhotosMigrationJob> {
    const existing = this.running.get(jobId);
    if (existing) return existing;
    const promise = this.runInternal(jobId).finally(() => this.running.delete(jobId));
    this.running.set(jobId, promise);
    return promise;
  }

  private async runInternal(jobId: string) {
    const job = await this.requireJob(jobId);
    if (!job.sourcePickerSessionId) throw new Error('GOOGLE_PHOTOS_PICKER_SESSION_MISSING');
    const sourceAccount = await this.requireAccount(job.sourceAccountId, 'picker');
    const sourceToken = await this.accessToken(sourceAccount);
    // Refresh session-bound base URLs immediately before every run/resume.
    const selected = await listAllPickedMedia(sourceToken, job.sourcePickerSessionId);
    const sources = new Map(selected.map(item => [item.id, item]));

    const runner = new GooglePhotosMigrationRunner(this.options.ledger, {
      transfer: async ({ job: currentJob, source, signal, onBytes }) => {
        const response = await downloadPickedMedia(source);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (currentJob.target === 'google_drive') {
          return this.options.uploadToDrive({ accountId: currentJob.targetAccountId, source, response, signal, onBytes });
        }
        const destination = await this.requireAccount(currentJob.targetAccountId, 'append');
        const destinationToken = await this.accessToken(destination);
        const bytes = await response.arrayBuffer();
        if (signal?.aborted) throw new Error('MIGRATION_ABORTED');
        onBytes?.(contentLength || bytes.byteLength);
        const uploadToken = await uploadPhotoBytes(destinationToken, bytes, source.mediaFile?.mimeType);
        const [created] = await createMediaItems(destinationToken, [{ uploadToken, filename: source.mediaFile?.filename }]);
        if (created?.status?.code && created.status.code !== 0) throw new Error(created.status.message || `GOOGLE_PHOTOS_CREATE_${created.status.code}`);
        const targetId = created?.mediaItem?.id;
        if (!targetId) throw new Error('GOOGLE_PHOTOS_DESTINATION_ID_MISSING');
        return { targetId, targetUrl: created.mediaItem?.productUrl };
      },
      verify: async ({ job: currentJob, targetId }) => {
        if (!targetId) throw new Error('MIGRATION_DESTINATION_NOT_VERIFIED');
        // Google Photos append-only scope cannot read arbitrary media back. batchCreate returning an ID is the authoritative acknowledgement.
        if (currentJob.target === 'google_photos') return;
      },
    });

    const result = await runner.run(jobId, sources, {
      shouldPause: () => this.paused.has(jobId),
      shouldCancel: () => this.cancelled.has(jobId),
    });
    await this.emit(jobId);
    if (['completed', 'completed_with_errors', 'cancelled'].includes(result.state)) {
      await deletePickingSession(sourceToken, job.sourcePickerSessionId).catch(() => undefined);
    }
    return result;
  }

  private async emit(jobId: string): Promise<MigrationSnapshot> {
    const snapshot = await this.getSnapshot(jobId);
    this.options.onUpdated?.(snapshot);
    return snapshot;
  }

  private async savedAccounts(): Promise<SavedGooglePhotosAccount[]> {
    await fs.mkdir(this.options.accountsDir, { recursive: true });
    const files = (await fs.readdir(this.options.accountsDir)).filter(file => file.endsWith('.json'));
    const result: SavedGooglePhotosAccount[] = [];
    for (const file of files) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(this.options.accountsDir, file), 'utf8')) as SavedGooglePhotosAccount;
        if (parsed.id && parsed.email && parsed.tokens) result.push(parsed);
      } catch {}
    }
    return result;
  }

  private async requireAccount(id: string, capability: GooglePhotosCapability) {
    const account = (await this.savedAccounts()).find(account => account.id === id);
    if (!account) throw new Error('GOOGLE_PHOTOS_ACCOUNT_NOT_FOUND');
    if (!account.capabilities.includes(capability)) throw new Error(`GOOGLE_PHOTOS_CAPABILITY_REQUIRED:${capability}`);
    return account;
  }

  private async accessToken(account: SavedGooglePhotosAccount): Promise<string> {
    const client = this.options.oauthClient();
    client.setCredentials(account.tokens);
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('GOOGLE_PHOTOS_ACCESS_TOKEN_MISSING');
    if (JSON.stringify(client.credentials) !== JSON.stringify(account.tokens)) {
      const refreshed = { ...account, tokens: client.credentials, updatedAt: new Date().toISOString() };
      await fs.writeFile(path.join(this.options.accountsDir, accountFilename(account.id)), JSON.stringify(refreshed, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
    return token.token;
  }

  private async requireJob(jobId: string) {
    const job = await this.options.ledger.getJob(jobId);
    if (!job || job.workspaceId !== this.options.workspaceId) throw new Error('MIGRATION_JOB_NOT_FOUND');
    return job;
  }
}
