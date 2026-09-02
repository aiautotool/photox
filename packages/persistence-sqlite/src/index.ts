import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { DurableJob, JobRepository, JobState } from '@photox/jobs';
import type { MediaApiScope, RefreshSessionStore, WorkspaceSessionRole } from '@photox/media-api';
import type { MediaCloudItem, MediaCloudQuery, MediaCloudRepository } from '@photox/media-cloud';
import type { VideoMediaRecord, VideoMediaRepository } from '@photox/video-media';

export interface SqlitePhotoXStoreOptions {
  path: string;
}

export class SqlitePhotoXStore {
  readonly db: DatabaseSync;
  constructor(options: SqlitePhotoXStoreOptions) {
    this.db = new DatabaseSync(options.path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.migrate();
  }
  close() { this.db.close(); }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL,
        priority INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_after TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT,
        checkpoint_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_photox_jobs_state_run_after ON photox_jobs(state, run_after);

      CREATE TABLE IF NOT EXISTS photox_media_cloud (
        asset_id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        item_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_photox_media_cloud_updated ON photox_media_cloud(updated_at);

      CREATE TABLE IF NOT EXISTS photox_video_media (
        asset_id TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS photox_refresh_sessions (
        session_id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        device_id TEXT,
        scopes_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_photox_refresh_token_hash ON photox_refresh_sessions(token_hash);
    `);
  }
}

export class SqliteJobRepository implements JobRepository {
  constructor(private readonly store: SqlitePhotoXStore) {}
  async put(job: DurableJob): Promise<void> {
    this.store.db.prepare(`INSERT INTO photox_jobs(id,type,payload_json,state,priority,attempts,max_attempts,run_after,created_at,updated_at,last_error,checkpoint_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET type=excluded.type,payload_json=excluded.payload_json,state=excluded.state,priority=excluded.priority,attempts=excluded.attempts,max_attempts=excluded.max_attempts,run_after=excluded.run_after,updated_at=excluded.updated_at,last_error=excluded.last_error,checkpoint_json=excluded.checkpoint_json`).run(
      job.id, job.type, JSON.stringify(job.payload), job.state, job.priority, job.attempts, job.maxAttempts, job.runAfter ?? null,
      job.createdAt, job.updatedAt, job.lastError ?? null, job.checkpoint ? JSON.stringify(job.checkpoint) : null,
    );
  }
  async get(id: string): Promise<DurableJob | null> {
    const row = this.store.db.prepare('SELECT * FROM photox_jobs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }
  async list(states?: JobState[]): Promise<DurableJob[]> {
    const rows = states?.length
      ? this.store.db.prepare(`SELECT * FROM photox_jobs WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY priority DESC, created_at ASC`).all(...states)
      : this.store.db.prepare('SELECT * FROM photox_jobs ORDER BY priority DESC, created_at ASC').all();
    return (rows as Record<string, unknown>[]).map((row) => this.map(row));
  }
  private map(row: Record<string, unknown>): DurableJob {
    return {
      id: String(row.id), type: String(row.type), payload: JSON.parse(String(row.payload_json)), state: String(row.state) as JobState,
      priority: Number(row.priority), attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
      runAfter: row.run_after ? String(row.run_after) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      lastError: row.last_error ? String(row.last_error) : undefined,
      checkpoint: row.checkpoint_json ? JSON.parse(String(row.checkpoint_json)) as Record<string, unknown> : undefined,
    };
  }
}

export class SqliteMediaCloudRepository implements MediaCloudRepository {
  constructor(private readonly store: SqlitePhotoXStore) {}
  async get(assetId: string): Promise<MediaCloudItem | null> {
    const row = this.store.db.prepare('SELECT item_json FROM photox_media_cloud WHERE asset_id=?').get(assetId) as { item_json?: string } | undefined;
    return row?.item_json ? JSON.parse(row.item_json) as MediaCloudItem : null;
  }
  async list(query: MediaCloudQuery = {}): Promise<MediaCloudItem[]> {
    const rows = this.store.db.prepare('SELECT item_json FROM photox_media_cloud ORDER BY updated_at DESC').all() as Array<{ item_json: string }>;
    let items = rows.map((row) => JSON.parse(row.item_json) as MediaCloudItem);
    if (query.providerId) items = items.filter((item) => item.replicas.some((r) => r.providerId === query.providerId));
    if (query.accountId) items = items.filter((item) => item.replicas.some((r) => r.accountId === query.accountId));
    if (query.text) { const q = query.text.toLowerCase(); items = items.filter((item) => item.filename.toLowerCase().includes(q) || item.assetId.toLowerCase().includes(q)); }
    const offset = Math.max(0, query.offset ?? 0); const limit = Math.max(0, query.limit ?? items.length);
    return items.slice(offset, offset + limit);
  }
  async upsert(item: MediaCloudItem): Promise<void> {
    this.store.db.prepare(`INSERT INTO photox_media_cloud(asset_id,filename,item_json,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(asset_id) DO UPDATE SET filename=excluded.filename,item_json=excluded.item_json,updated_at=excluded.updated_at`).run(
      item.assetId, item.filename, JSON.stringify(item), item.updatedAt,
    );
  }
  async remove(assetId: string): Promise<void> { this.store.db.prepare('DELETE FROM photox_media_cloud WHERE asset_id=?').run(assetId); }
}

export class SqliteVideoMediaRepository implements VideoMediaRepository {
  constructor(private readonly store: SqlitePhotoXStore) {}
  async get(assetId: string): Promise<VideoMediaRecord | null> {
    const row = this.store.db.prepare('SELECT record_json FROM photox_video_media WHERE asset_id=?').get(assetId) as { record_json?: string } | undefined;
    return row?.record_json ? JSON.parse(row.item_json) as VideoMediaRecord : null;
  }
  async save(record: VideoMediaRecord): Promise<void> {
    this.store.db.prepare(`INSERT INTO photox_video_media(asset_id,record_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(asset_id) DO UPDATE SET record_json=excluded.record_json,updated_at=excluded.updated_at`).run(record.assetId, JSON.stringify(record), record.updatedAt);
  }
  async remove(assetId: string): Promise<void> { this.store.db.prepare('DELETE FROM photox_video_media WHERE asset_id=?').run(assetId); }
}

export class SqliteRefreshSessionStore implements RefreshSessionStore {
  constructor(private readonly store: SqlitePhotoXStore) { this.ensureWorkspaceColumns(); }
  private ensureWorkspaceColumns() {
    const columns = new Set((this.store.db.prepare('PRAGMA table_info(photox_refresh_sessions)').all() as Array<{ name: string }>).map(row => row.name));
    if (!columns.has('workspace_id')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_id TEXT');
    if (!columns.has('workspace_role')) this.store.db.exec('ALTER TABLE photox_refresh_sessions ADD COLUMN workspace_role TEXT');
  }
  async create(input: { subject: string; deviceId?: string; workspaceId?: string; workspaceRole?: WorkspaceSessionRole; scopes: MediaApiScope[]; expiresAt: number }): Promise<{ refreshToken: string; sessionId: string }> {
    const refreshToken = randomBytes(48).toString('base64url');
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.store.db.prepare('INSERT INTO photox_refresh_sessions(session_id,token_hash,subject,device_id,workspace_id,workspace_role,scopes_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      sessionId, this.hash(refreshToken), input.subject, input.deviceId ?? null, input.workspaceId ?? null, input.workspaceRole ?? null, JSON.stringify(input.scopes), input.expiresAt, now,
    );
    return { refreshToken, sessionId };
  }
  async consume(refreshToken: string): Promise<{ subject: string; deviceId?: string; workspaceId?: string; workspaceRole?: WorkspaceSessionRole; scopes: MediaApiScope[]; sessionId: string } | null> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.store.db.prepare('SELECT * FROM photox_refresh_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').get(this.hash(refreshToken), now) as Record<string, unknown> | undefined;
    if (!row) return null;
    this.store.db.prepare('UPDATE photox_refresh_sessions SET last_used_at=? WHERE session_id=?').run(now, String(row.session_id));
    return {
      subject: String(row.subject), deviceId: row.device_id ? String(row.device_id) : undefined,
      workspaceId: row.workspace_id ? String(row.workspace_id) : undefined,
      workspaceRole: row.workspace_role ? String(row.workspace_role) as WorkspaceSessionRole : undefined,
      scopes: JSON.parse(String(row.scopes_json)) as MediaApiScope[], sessionId: String(row.session_id),
    };
  }
  async revoke(sessionId: string): Promise<void> { this.store.db.prepare('UPDATE photox_refresh_sessions SET revoked_at=? WHERE session_id=?').run(Math.floor(Date.now() / 1000), sessionId); }
  private hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
}

export * from './migration';
export * from './workspace.js';
