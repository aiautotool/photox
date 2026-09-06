import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { SqlitePhotoXStore } from './index.js';

export type SqliteMediaIndexIdentity = {
  workspaceId: string;
  key: string;
};

export type MediaIndexJsonImportMarker = {
  version: 1;
  sourceSha256: string;
  importedCount: number;
  importedAt: string;
  backupPath: string;
};

export type MediaIndexJsonMigrationResult = {
  status: 'IMPORTED' | 'ALREADY_IMPORTED' | 'SOURCE_MISSING';
  importedCount: number;
  sourceSha256?: string;
  backupPath?: string;
};

const MEDIA_INDEX_SCHEMA_VERSION = 1;
const IMPORT_MARKER_KEY = 'media-index-json-import-v1';

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertIdentity(value: unknown, index: number): asserts value is SqliteMediaIndexIdentity & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MEDIA_INDEX_MIGRATION_ROW_INVALID:${index}`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.workspaceId !== 'string' || !row.workspaceId.trim()) {
    throw new Error(`MEDIA_INDEX_MIGRATION_WORKSPACE_REQUIRED:${index}`);
  }
  if (typeof row.key !== 'string' || !row.key.trim()) {
    throw new Error(`MEDIA_INDEX_MIGRATION_KEY_REQUIRED:${index}`);
  }
}

function parseLegacyRows<T extends SqliteMediaIndexIdentity>(content: Buffer): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error('MEDIA_INDEX_MIGRATION_JSON_INVALID');
  }
  if (!Array.isArray(parsed)) throw new Error('MEDIA_INDEX_MIGRATION_ROOT_INVALID');

  const seen = new Set<string>();
  parsed.forEach((value, index) => {
    assertIdentity(value, index);
    const identity = `${value.workspaceId}\u0000${value.key}`;
    if (seen.has(identity)) throw new Error(`MEDIA_INDEX_MIGRATION_DUPLICATE_IDENTITY:${value.workspaceId}:${value.key}`);
    seen.add(identity);
  });
  return parsed as T[];
}

function ensureBackup(sourcePath: string, source: Buffer, backupPath: string): void {
  if (resolve(sourcePath) === resolve(backupPath)) throw new Error('MEDIA_INDEX_MIGRATION_BACKUP_PATH_INVALID');
  if (existsSync(backupPath)) {
    const backup = readFileSync(backupPath);
    if (sha256(backup) !== sha256(source)) throw new Error('MEDIA_INDEX_MIGRATION_BACKUP_MISMATCH');
    return;
  }
  copyFileSync(sourcePath, backupPath, constants.COPYFILE_EXCL);
  const fd = openSync(backupPath, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeAtomicJson(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, 'wx');
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
    try {
      const dirFd = openSync(dirname(path), 'r');
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch {
      // Some platforms/filesystems do not support directory fsync. The file itself
      // is already fsynced before rename, so keep this a best-effort durability step.
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tempPath); } catch { /* no-op */ }
    throw error;
  }
}

export class SqliteMediaIndexCatalog<T extends SqliteMediaIndexIdentity & Record<string, unknown>> {
  constructor(private readonly store: SqlitePhotoXStore) {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_media_index (
        workspace_id TEXT NOT NULL,
        media_key TEXT NOT NULL,
        row_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id, media_key)
      );
      CREATE INDEX IF NOT EXISTS idx_photox_media_index_workspace_updated
        ON photox_media_index(workspace_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS photox_media_index_meta (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.setSchemaVersion();
  }

  private setSchemaVersion(): void {
    const key = 'schema-version';
    const existing = this.store.db.prepare('SELECT meta_value FROM photox_media_index_meta WHERE meta_key=?').get(key) as { meta_value?: string } | undefined;
    if (existing && Number(existing.meta_value) > MEDIA_INDEX_SCHEMA_VERSION) {
      throw new Error(`MEDIA_INDEX_SCHEMA_TOO_NEW:${existing.meta_value}`);
    }
    if (!existing) {
      this.store.db.prepare('INSERT INTO photox_media_index_meta(meta_key,meta_value,updated_at) VALUES(?,?,?)')
        .run(key, String(MEDIA_INDEX_SCHEMA_VERSION), new Date().toISOString());
    }
  }

  get(workspaceId: string, key: string): T | null {
    if (!workspaceId || !key) return null;
    const row = this.store.db.prepare('SELECT row_json FROM photox_media_index WHERE workspace_id=? AND media_key=?')
      .get(workspaceId, key) as { row_json?: string } | undefined;
    return row?.row_json ? JSON.parse(row.row_json) as T : null;
  }

  listWorkspace(workspaceId: string): T[] {
    if (!workspaceId) return [];
    return (this.store.db.prepare('SELECT row_json FROM photox_media_index WHERE workspace_id=? ORDER BY rowid ASC')
      .all(workspaceId) as Array<{ row_json: string }>).map(row => JSON.parse(row.row_json) as T);
  }

  listAll(): T[] {
    return (this.store.db.prepare('SELECT row_json FROM photox_media_index ORDER BY rowid ASC').all() as Array<{ row_json: string }>)
      .map(row => JSON.parse(row.row_json) as T);
  }

  append(row: T): T {
    assertIdentity(row, 0);
    try {
      this.store.db.prepare('INSERT INTO photox_media_index(workspace_id,media_key,row_json,updated_at) VALUES(?,?,?,?)')
        .run(row.workspaceId, row.key, JSON.stringify(row), new Date().toISOString());
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw new Error('MEDIA_INDEX_DUPLICATE_KEY');
      throw error;
    }
    return row;
  }

  patch(workspaceId: string, key: string, mutate: (current: T) => T): T | null {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(workspaceId, key);
      if (!current) {
        this.store.db.exec('COMMIT');
        return null;
      }
      const next = mutate(current);
      assertIdentity(next, 0);
      if (next.workspaceId !== workspaceId || next.key !== key) throw new Error('MEDIA_INDEX_IDENTITY_IMMUTABLE');
      this.store.db.prepare('UPDATE photox_media_index SET row_json=?,updated_at=? WHERE workspace_id=? AND media_key=?')
        .run(JSON.stringify(next), new Date().toISOString(), workspaceId, key);
      this.store.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  remove(workspaceId: string, key: string): T | null {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(workspaceId, key);
      if (!current) {
        this.store.db.exec('COMMIT');
        return null;
      }
      this.store.db.prepare('DELETE FROM photox_media_index WHERE workspace_id=? AND media_key=?').run(workspaceId, key);
      this.store.db.exec('COMMIT');
      return current;
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  getImportMarker(): MediaIndexJsonImportMarker | null {
    const row = this.store.db.prepare('SELECT meta_value FROM photox_media_index_meta WHERE meta_key=?').get(IMPORT_MARKER_KEY) as { meta_value?: string } | undefined;
    return row?.meta_value ? JSON.parse(row.meta_value) as MediaIndexJsonImportMarker : null;
  }

  migrateLegacyJson(sourcePath: string, backupPath = `${sourcePath}.pre-sqlite-v1.json`): MediaIndexJsonMigrationResult {
    if (!existsSync(sourcePath)) return { status: 'SOURCE_MISSING', importedCount: 0 };
    const source = readFileSync(sourcePath);
    const sourceSha256 = sha256(source);
    const rows = parseLegacyRows<T>(source);
    const marker = this.getImportMarker();
    if (marker) {
      if (marker.sourceSha256 !== sourceSha256) throw new Error('MEDIA_INDEX_MIGRATION_SOURCE_CHANGED');
      return {
        status: 'ALREADY_IMPORTED',
        importedCount: marker.importedCount,
        sourceSha256,
        backupPath: marker.backupPath,
      };
    }

    ensureBackup(sourcePath, source, backupPath);
    const existing = this.store.db.prepare('SELECT COUNT(*) AS count FROM photox_media_index').get() as { count: number | bigint };
    if (Number(existing.count) !== 0) throw new Error('MEDIA_INDEX_MIGRATION_TARGET_NOT_EMPTY');

    const importedAt = new Date().toISOString();
    const markerValue: MediaIndexJsonImportMarker = { version: 1, sourceSha256, importedCount: rows.length, importedAt, backupPath };
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.store.db.prepare('INSERT INTO photox_media_index(workspace_id,media_key,row_json,updated_at) VALUES(?,?,?,?)');
      for (const row of rows) insert.run(row.workspaceId, row.key, JSON.stringify(row), importedAt);
      this.store.db.prepare('INSERT INTO photox_media_index_meta(meta_key,meta_value,updated_at) VALUES(?,?,?)')
        .run(IMPORT_MARKER_KEY, JSON.stringify(markerValue), importedAt);
      this.store.db.exec('COMMIT');
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
    return { status: 'IMPORTED', importedCount: rows.length, sourceSha256, backupPath };
  }

  exportLegacyJson(targetPath: string): { exportedCount: number; sha256: string } {
    const rows = this.listAll();
    const content = `${JSON.stringify(rows, null, 2)}\n`;
    writeAtomicJson(targetPath, content);
    return { exportedCount: rows.length, sha256: sha256(content) };
  }
}
