import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { DurableJob, JobRepository, JobState } from '@photox/jobs';
import type { MediaApiScope, RefreshSessionStore, WorkspaceSessionRole } from '@photox/media-api';
import type { MediaCloudItem, MediaCloudQuery, MediaCloudRepository } from '@photox/media-cloud';
import type { VideoMediaRecord, VideoMediaRepository } from '@photox/video-media';

export interface SqlitePhotoXStoreOptions { path: string; }

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
  constructor(private readonly store: SqlitePhotoXStore, private readonly workspaceId: string, private readonly legacyWorkspaceId = workspaceId) {
    if (!workspaceId) throw new Error('JOB_WORKSPACE_REQUIRED');
    if (!legacyWorkspaceId) throw new Error('JOB_LEGACY_WORKSPACE_REQUIRED');
    this.ensureWorkspaceSchema();
  }

  private ensureWorkspaceSchema() {
    const columns = this.store.db.prepare('PRAGMA table_info(photox_jobs)').all() as Array<{ name: string; pk: number }>;
    const hasWorkspace = columns.some(column => column.name === 'workspace_id');
    const compositePrimaryKey = columns.some(column => column.name === 'workspace_id' && column.pk > 0)
      && columns.some(column => column.name === 'id' && column.pk > 0);
    if (hasWorkspace && compositePrimaryKey) return;

    const legacyRows = this.store.db.prepare('SELECT * FROM photox_jobs').all() as Record<string, unknown>[];
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.exec(`
        DROP TABLE IF EXISTS photox_jobs_legacy_v1;
        ALTER TABLE photox_jobs RENAME TO photox_jobs_legacy_v1;
        CREATE TABLE photox_jobs (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
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
          checkpoint_json TEXT,
          PRIMARY KEY(workspace_id, id)
        );
      `);
      const insert = this.store.db.prepare(`INSERT INTO photox_jobs(workspace_id,id,type,payload_json,state,priority,attempts,max_attempts,run_after,created_at,updated_at,last_error,checkpoint_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const row of legacyRows) {
        insert.run(
          this.legacyWorkspaceId,
          String(row.id),
          String(row.type),
          String(row.payload_json),
          String(row.state),
          Number(row.priority),
          Number(row.attempts),
          Number(row.max_attempts),
          row.run_after == null ? null : String(row.run_after),
          String(row.created_at),
          String(row.updated_at),
          row.last_error == null ? null : String(row.last_error),
          row.checkpoint_json == null ? null : String(row.checkpoint_json),
        );
      }
      this.store.db.exec(`
        DROP TABLE photox_jobs_legacy_v1;
        CREATE INDEX IF NOT EXISTS idx_photox_jobs_workspace_state_run_after ON photox_jobs(workspace_id, state, run_after);
      `);
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  async put(job: DurableJob): Promise<void> {
    if (job.workspaceId !== this.workspaceId) throw new Error('JOB_WORKSPACE_MISMATCH');
    this.store.db.prepare(`INSERT INTO photox_jobs(workspace_id,id,type,payload_json,state,priority,attempts,max_attempts,run_after,created_at,updated_at,last_error,checkpoint_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,id) DO UPDATE SET type=excluded.type,payload_json=excluded.payload_json,state=excluded.state,priority=excluded.priority,attempts=excluded.attempts,max_attempts=excluded.max_attempts,run_after=excluded.run_after,updated_at=excluded.updated_at,last_error=excluded.last_error,checkpoint_json=excluded.checkpoint_json`).run(
      this.workspaceId, job.id, job.type, JSON.stringify(job.payload), job.state, job.priority, job.attempts, job.maxAttempts, job.runAfter ?? null,
      job.createdAt, job.updatedAt, job.lastError ?? null, job.checkpoint ? JSON.stringify(job.checkpoint) : null,
    );
  }
  async get(workspaceId: string, id: string): Promise<DurableJob | null> {
    if (workspaceId !== this.workspaceId) return null;
    const row = this.store.db.prepare('SELECT * FROM photox_jobs WHERE workspace_id=? AND id=?').get(this.workspaceId, id) as Record<string, unknown> | undefined;
    return row ? this.map(row) : null;
  }
  async list(workspaceId: string, states?: JobState[]): Promise<DurableJob[]> {
    if (workspaceId !== this.workspaceId) return [];
    const rows = states?.length
      ? this.store.db.prepare(`SELECT * FROM photox_jobs WHERE workspace_id=? AND state IN (${states.map(() => '?').join(',')}) ORDER BY priority DESC, created_at ASC`).all(this.workspaceId, ...states)
      : this.store.db.prepare('SELECT * FROM photox_jobs WHERE workspace_id=? ORDER BY priority DESC, created_at ASC').all(this.workspaceId);
    return (rows as Record<string, unknown>[]).map(row => this.map(row));
  }
  private map(row: Record<string, unknown>): DurableJob {
    return {
      id: String(row.id), workspaceId: String(row.workspace_id), type: String(row.type), payload: JSON.parse(String(row.payload_json)), state: String(row.state) as JobState,
      priority: Number(row.priority), attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts),
      runAfter: row.run_after ? String(row.run_after) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      lastError: row.last_error ? String(row.last_error) : undefined,
      checkpoint: row.checkpoint_json ? JSON.parse(String(row.checkpoint_json)) as Record<string, unknown> : undefined,
    };
  }
}

export class SqliteMediaCloudRepository implements MediaCloudRepository {
  constructor(private readonly store: SqlitePhotoXStore, private readonly legacyWorkspaceId: string) {
    if (!legacyWorkspaceId) throw new Error('MEDIA_CLOUD_LEGACY_WORKSPACE_REQUIRED');
    this.ensureWorkspaceSchema();
  }

  private ensureWorkspaceSchema() {
    const columns = this.store.db.prepare('PRAGMA table_info(photox_media_cloud)').all() as Array<{ name: string; pk: number }>;
    const hasWorkspace = columns.some((column) => column.name === 'workspace_id');
    const compositePrimaryKey = columns.some((column) => column.name === 'workspace_id' && column.pk > 0)
      && columns.some((column) => column.name === 'asset_id' && column.pk > 0);
    if (hasWorkspace && compositePrimaryKey) return;

    const legacyRows = this.store.db.prepare('SELECT asset_id,filename,item_json,updated_at FROM photox_media_cloud').all() as Array<{
      asset_id: string; filename: string; item_json: string; updated_at: string;
    }>;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.exec(`
        DROP TABLE IF EXISTS photox_media_cloud_legacy_v1;
        ALTER TABLE photox_media_cloud RENAME TO photox_media_cloud_legacy_v1;
        CREATE TABLE photox_media_cloud (
          workspace_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          filename TEXT NOT NULL,
          item_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, asset_id)
        );
      `);
      const insert = this.store.db.prepare('INSERT INTO photox_media_cloud(workspace_id,asset_id,filename,item_json,updated_at) VALUES(?,?,?,?,?)');
      for (const row of legacyRows) {
        const parsed = JSON.parse(row.item_json) as Partial<MediaCloudItem>;
        const workspaceId = parsed.workspaceId || this.legacyWorkspaceId;
        const item = { ...parsed, workspaceId } as MediaCloudItem;
        insert.run(workspaceId, row.asset_id, row.filename, JSON.stringify(item), row.updated_at);
      }
      this.store.db.exec(`
        DROP TABLE photox_media_cloud_legacy_v1;
        CREATE INDEX IF NOT EXISTS idx_photox_media_cloud_workspace_updated ON photox_media_cloud(workspace_id, updated_at DESC);
      `);
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  async get(workspaceId: string, assetId: string): Promise<MediaCloudItem | null> {
    const row = this.store.db.prepare('SELECT item_json FROM photox_media_cloud WHERE workspace_id=? AND asset_id=?').get(workspaceId, assetId) as { item_json?: string } | undefined;
    return row?.item_json ? JSON.parse(row.item_json) as MediaCloudItem : null;
  }
  async list(query: MediaCloudQuery): Promise<MediaCloudItem[]> {
    const rows = this.store.db.prepare('SELECT item_json FROM photox_media_cloud WHERE workspace_id=? ORDER BY updated_at DESC').all(query.workspaceId) as Array<{ item_json: string }>;
    let items = rows.map((row) => JSON.parse(row.item_json) as MediaCloudItem);
    if (query.providerId) items = items.filter((item) => item.replicas.some((r) => r.providerId === query.providerId));
    if (query.accountId) items = items.filter((item) => item.replicas.some((r) => r.accountId === query.accountId));
    if (query.text) { const q = query.text.toLowerCase(); items = items.filter((item) => item.filename.toLowerCase().includes(q) || item.assetId.toLowerCase().includes(q)); }
    const offset = Math.max(0, query.offset ?? 0); const limit = Math.max(0, query.limit ?? items.length);
    return items.slice(offset, offset + limit);
  }
  async upsert(item: MediaCloudItem): Promise<void> {
    if (!item.workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_REQUIRED');
    this.store.db.prepare(`INSERT INTO photox_media_cloud(workspace_id,asset_id,filename,item_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(workspace_id,asset_id) DO UPDATE SET filename=excluded.filename,item_json=excluded.item_json,updated_at=excluded.updated_at`).run(
      item.workspaceId, item.assetId, item.filename, JSON.stringify(item), item.updatedAt,
    );
  }
  async remove(workspaceId: string, assetId: string): Promise<void> {
    this.store.db.prepare('DELETE FROM photox_media_cloud WHERE workspace_id=? AND asset_id=?').run(workspaceId, assetId);
  }
}

export class SqliteVideoMediaRepository implements VideoMediaRepository {
  constructor(private readonly store: SqlitePhotoXStore, private readonly workspaceId: string, private readonly legacyWorkspaceId = workspaceId) {
    if (!workspaceId) throw new Error('VIDEO_MEDIA_WORKSPACE_REQUIRED');
    if (!legacyWorkspaceId) throw new Error('VIDEO_MEDIA_LEGACY_WORKSPACE_REQUIRED');
    this.ensureWorkspaceSchema();
  }

  private ensureWorkspaceSchema() {
    const columns = this.store.db.prepare('PRAGMA table_info(photox_video_media)').all() as Array<{ name: string; pk: number }>;
    const hasWorkspace = columns.some((column) => column.name === 'workspace_id');
    const compositePrimaryKey = columns.some((column) => column.name === 'workspace_id' && column.pk > 0)
      && columns.some((column) => column.name === 'asset_id' && column.pk > 0);
    if (hasWorkspace && compositePrimaryKey) return;

    const legacyRows = this.store.db.prepare('SELECT asset_id,record_json,updated_at FROM photox_video_media').all() as Array<{
      asset_id: string; record_json: string; updated_at: string;
    }>;
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.exec(`
        DROP TABLE IF EXISTS photox_video_media_legacy_v1;
        ALTER TABLE photox_video_media RENAME TO photox_video_media_legacy_v1;
        CREATE TABLE photox_video_media (
          workspace_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, asset_id)
        );
      `);
      const insert = this.store.db.prepare('INSERT INTO photox_video_media(workspace_id,asset_id,record_json,updated_at) VALUES(?,?,?,?)');
      for (const row of legacyRows) {
        const parsed = JSON.parse(row.record_json) as Partial<VideoMediaRecord>;
        const workspaceId = parsed.workspaceId || this.legacyWorkspaceId;
        const record = { ...parsed, workspaceId, assetId: row.asset_id, updatedAt: parsed.updatedAt || row.updated_at } as VideoMediaRecord;
        insert.run(workspaceId, row.asset_id, JSON.stringify(record), record.updatedAt);
      }
      this.store.db.exec(`
        DROP TABLE photox_video_media_legacy_v1;
        CREATE INDEX IF NOT EXISTS idx_photox_video_media_workspace_updated ON photox_video_media(workspace_id, updated_at DESC);
      `);
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  async get(workspaceId: string, assetId: string): Promise<VideoMediaRecord | null> {
    if (workspaceId !== this.workspaceId) return null;
    const row = this.store.db.prepare('SELECT record_json FROM photox_video_media WHERE workspace_id=? AND asset_id=?').get(this.workspaceId, assetId) as { record_json?: string } | undefined;
    return row?.record_json ? JSON.parse(row.record_json) as VideoMediaRecord : null;
  }
  async save(record: VideoMediaRecord): Promise<void> {
    if (record.workspaceId !== this.workspaceId) throw new Error('VIDEO_MEDIA_WORKSPACE_MISMATCH');
    this.store.db.prepare(`INSERT INTO photox_video_media(workspace_id,asset_id,record_json,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(workspace_id,asset_id) DO UPDATE SET record_json=excluded.record_json,updated_at=excluded.updated_at`).run(
      this.workspaceId, record.assetId, JSON.stringify(record), record.updatedAt,
    );
  }
  async remove(workspaceId: string, assetId: string): Promise<void> {
    if (workspaceId !== this.workspaceId) return;
    this.store.db.prepare('DELETE FROM photox_video_media WHERE workspace_id=? AND asset_id=?').run(this.workspaceId, assetId);
  }
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
export * from './mediaIndexCatalog.js';
export * from './workspace.js';