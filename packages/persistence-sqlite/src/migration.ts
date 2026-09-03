import type {
  GooglePhotosMigrationItem,
  GooglePhotosMigrationJob,
  GooglePhotosMigrationLedger,
  MigrationItemState,
  MigrationJobState,
  MigrationTarget,
  MigrationTransferCheckpoint,
} from '@photosync/google-photos';
import type { SqlitePhotoXStore } from './index';

export class SqliteGooglePhotosMigrationLedger implements GooglePhotosMigrationLedger {
  constructor(private readonly store: SqlitePhotoXStore) {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_migration_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        source_account_id TEXT NOT NULL,
        source_picker_session_id TEXT,
        target TEXT NOT NULL,
        target_account_id TEXT NOT NULL,
        state TEXT NOT NULL,
        total_items INTEGER NOT NULL,
        completed_items INTEGER NOT NULL,
        failed_items INTEGER NOT NULL,
        total_bytes INTEGER,
        transferred_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_photox_migration_jobs_workspace_updated
        ON photox_migration_jobs(workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS photox_migration_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES photox_migration_jobs(id) ON DELETE CASCADE,
        source_media_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT,
        size_bytes INTEGER,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        transferred_bytes INTEGER NOT NULL,
        target_id TEXT,
        target_url TEXT,
        checkpoint_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(job_id, source_media_id)
      );
      CREATE INDEX IF NOT EXISTS idx_photox_migration_items_job_state
        ON photox_migration_items(job_id, state, updated_at);
    `);
    const itemColumns = new Set((this.store.db.prepare('PRAGMA table_info(photox_migration_items)').all() as Array<{ name: string }>).map(row => row.name));
    if (!itemColumns.has('checkpoint_json')) this.store.db.exec('ALTER TABLE photox_migration_items ADD COLUMN checkpoint_json TEXT');
  }

  async createJob(job: GooglePhotosMigrationJob): Promise<void> {
    this.store.db.prepare(`INSERT INTO photox_migration_jobs(
      id,workspace_id,source_account_id,source_picker_session_id,target,target_account_id,state,total_items,completed_items,failed_items,total_bytes,transferred_bytes,created_at,updated_at,started_at,completed_at,last_error
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      job.id, job.workspaceId, job.sourceAccountId, job.sourcePickerSessionId ?? null, job.target, job.targetAccountId,
      job.state, job.totalItems, job.completedItems, job.failedItems, job.totalBytes ?? null, job.transferredBytes,
      job.createdAt, job.updatedAt, job.startedAt ?? null, job.completedAt ?? null, job.lastError ?? null,
    );
  }

  async getJob(jobId: string): Promise<GooglePhotosMigrationJob | null> {
    const row = this.store.db.prepare('SELECT * FROM photox_migration_jobs WHERE id=?').get(jobId) as Record<string, unknown> | undefined;
    return row ? this.mapJob(row) : null;
  }

  async listJobs(workspaceId: string): Promise<GooglePhotosMigrationJob[]> {
    return (this.store.db.prepare('SELECT * FROM photox_migration_jobs WHERE workspace_id=? ORDER BY updated_at DESC').all(workspaceId) as Record<string, unknown>[])
      .map(row => this.mapJob(row));
  }

  async updateJob(jobId: string, patch: Partial<Omit<GooglePhotosMigrationJob, 'id' | 'workspaceId' | 'createdAt'>>): Promise<GooglePhotosMigrationJob | null> {
    const current = await this.getJob(jobId);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.store.db.prepare(`UPDATE photox_migration_jobs SET
      source_account_id=?,source_picker_session_id=?,target=?,target_account_id=?,state=?,total_items=?,completed_items=?,failed_items=?,total_bytes=?,transferred_bytes=?,updated_at=?,started_at=?,completed_at=?,last_error=? WHERE id=?`).run(
      next.sourceAccountId, next.sourcePickerSessionId ?? null, next.target, next.targetAccountId, next.state, next.totalItems,
      next.completedItems, next.failedItems, next.totalBytes ?? null, next.transferredBytes, next.updatedAt, next.startedAt ?? null,
      next.completedAt ?? null, next.lastError ?? null, jobId,
    );
    return next;
  }

  async putItems(items: GooglePhotosMigrationItem[]): Promise<void> {
    const statement = this.store.db.prepare(`INSERT INTO photox_migration_items(
      id,job_id,source_media_id,filename,mime_type,size_bytes,state,attempts,transferred_bytes,target_id,target_url,error,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,state=excluded.state,attempts=excluded.attempts,transferred_bytes=excluded.transferred_bytes,target_id=excluded.target_id,target_url=excluded.target_url,error=excluded.error,updated_at=excluded.updated_at`);
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) statement.run(
        item.id, item.jobId, item.sourceMediaId, item.filename, item.mimeType ?? null, item.sizeBytes ?? null, item.state,
        item.attempts, item.transferredBytes, item.targetId ?? null, item.targetUrl ?? null, item.error ?? null, item.createdAt, item.updatedAt,
      );
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  async listItems(jobId: string): Promise<GooglePhotosMigrationItem[]> {
    return (this.store.db.prepare('SELECT * FROM photox_migration_items WHERE job_id=? ORDER BY created_at,id').all(jobId) as Record<string, unknown>[])
      .map(row => this.mapItem(row));
  }

  async updateItem(itemId: string, patch: Partial<Omit<GooglePhotosMigrationItem, 'id' | 'jobId' | 'sourceMediaId' | 'createdAt'>>): Promise<GooglePhotosMigrationItem | null> {
    const row = this.store.db.prepare('SELECT * FROM photox_migration_items WHERE id=?').get(itemId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const current = this.mapItem(row);
    const next = { ...current, ...patch };
    this.store.db.prepare(`UPDATE photox_migration_items SET filename=?,mime_type=?,size_bytes=?,state=?,attempts=?,transferred_bytes=?,target_id=?,target_url=?,error=?,updated_at=? WHERE id=?`).run(
      next.filename, next.mimeType ?? null, next.sizeBytes ?? null, next.state, next.attempts, next.transferredBytes,
      next.targetId ?? null, next.targetUrl ?? null, next.error ?? null, next.updatedAt, itemId,
    );
    return next;
  }


  async getTransferCheckpoint(itemId: string): Promise<MigrationTransferCheckpoint | null> {
    const row = this.store.db.prepare('SELECT checkpoint_json FROM photox_migration_items WHERE id=?').get(itemId) as { checkpoint_json?: string | null } | undefined;
    return row?.checkpoint_json ? JSON.parse(row.checkpoint_json) as MigrationTransferCheckpoint : null;
  }

  async setTransferCheckpoint(itemId: string, checkpoint: MigrationTransferCheckpoint | null): Promise<void> {
    this.store.db.prepare('UPDATE photox_migration_items SET checkpoint_json=?,updated_at=? WHERE id=?').run(
      checkpoint ? JSON.stringify(checkpoint) : null, new Date().toISOString(), itemId,
    );
  }

  private mapJob(row: Record<string, unknown>): GooglePhotosMigrationJob {
    return {
      id: String(row.id), workspaceId: String(row.workspace_id), sourceAccountId: String(row.source_account_id),
      sourcePickerSessionId: row.source_picker_session_id ? String(row.source_picker_session_id) : undefined,
      target: String(row.target) as MigrationTarget, targetAccountId: String(row.target_account_id), state: String(row.state) as MigrationJobState,
      totalItems: Number(row.total_items), completedItems: Number(row.completed_items), failedItems: Number(row.failed_items),
      totalBytes: row.total_bytes === null || row.total_bytes === undefined ? undefined : Number(row.total_bytes), transferredBytes: Number(row.transferred_bytes),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), startedAt: row.started_at ? String(row.started_at) : undefined,
      completedAt: row.completed_at ? String(row.completed_at) : undefined, lastError: row.last_error ? String(row.last_error) : undefined,
    };
  }

  private mapItem(row: Record<string, unknown>): GooglePhotosMigrationItem {
    return {
      id: String(row.id), jobId: String(row.job_id), sourceMediaId: String(row.source_media_id), filename: String(row.filename),
      mimeType: row.mime_type ? String(row.mime_type) : undefined, sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? undefined : Number(row.size_bytes),
      state: String(row.state) as MigrationItemState, attempts: Number(row.attempts), transferredBytes: Number(row.transferred_bytes),
      targetId: row.target_id ? String(row.target_id) : undefined, targetUrl: row.target_url ? String(row.target_url) : undefined,
      error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
}
