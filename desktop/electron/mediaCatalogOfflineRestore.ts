import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore, type SqliteMediaIndexIdentity } from '@photox/persistence-sqlite';
import { acquireMediaCatalogAuthorityLease } from './mediaCatalogAuthorityLease.js';

export type OfflineMediaCatalogRestoreOptions = {
  sqlitePath: string;
  sourcePath: string;
  expectedSha256: string;
  backupPath?: string;
  leasePath?: string;
};

export type OfflineMediaCatalogRestoreResult = {
  restoredCount: number;
  sourceSha256: string;
  backupPath: string;
};

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function parseRows<T extends SqliteMediaIndexIdentity & Record<string, unknown>>(content: Buffer): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error('MEDIA_CATALOG_RESTORE_JSON_INVALID');
  }
  if (!Array.isArray(parsed)) throw new Error('MEDIA_CATALOG_RESTORE_ROOT_INVALID');

  const seen = new Set<string>();
  parsed.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`MEDIA_CATALOG_RESTORE_ROW_INVALID:${index}`);
    const row = value as Partial<SqliteMediaIndexIdentity>;
    if (typeof row.workspaceId !== 'string' || !row.workspaceId.trim()) throw new Error(`MEDIA_CATALOG_RESTORE_WORKSPACE_REQUIRED:${index}`);
    if (typeof row.key !== 'string' || !row.key.trim()) throw new Error(`MEDIA_CATALOG_RESTORE_KEY_REQUIRED:${index}`);
    const identity = `${row.workspaceId}\u0000${row.key}`;
    if (seen.has(identity)) throw new Error(`MEDIA_CATALOG_RESTORE_DUPLICATE_IDENTITY:${row.workspaceId}:${row.key}`);
    seen.add(identity);
  });
  return parsed as T[];
}

/**
 * Restores only the authoritative media-catalog rows from a previously verified
 * offline JSON export. The SQLite file remains the sole runtime authority; this
 * never promotes JSON to a live writer and never replaces the database file.
 *
 * The same authority lease as Desktop runtime/export is held for the whole
 * operation. Current rows are exported to a pre-restore JSON artifact before a
 * single SQLite transaction replaces catalog rows. Migration/schema metadata is
 * preserved so normal startup validation remains authoritative after restore.
 */
export function restoreMediaCatalogOffline<T extends SqliteMediaIndexIdentity & Record<string, unknown>>(
  options: OfflineMediaCatalogRestoreOptions,
): OfflineMediaCatalogRestoreResult {
  if (!options.sqlitePath.trim()) throw new Error('MEDIA_CATALOG_RESTORE_SQLITE_PATH_REQUIRED');
  if (!options.sourcePath.trim()) throw new Error('MEDIA_CATALOG_RESTORE_SOURCE_PATH_REQUIRED');
  if (!/^[a-f0-9]{64}$/i.test(options.expectedSha256.trim())) throw new Error('MEDIA_CATALOG_RESTORE_SHA256_REQUIRED');

  const sqlitePath = path.resolve(options.sqlitePath);
  const sourcePath = path.resolve(options.sourcePath);
  if (sqlitePath === sourcePath) throw new Error('MEDIA_CATALOG_RESTORE_SOURCE_CONFLICT');
  if (!existsSync(sqlitePath)) throw new Error('MEDIA_CATALOG_RESTORE_SQLITE_MISSING');
  if (!existsSync(sourcePath)) throw new Error('MEDIA_CATALOG_RESTORE_SOURCE_MISSING');

  const source = readFileSync(sourcePath);
  const sourceSha256 = sha256(source);
  if (sourceSha256.toLowerCase() !== options.expectedSha256.trim().toLowerCase()) {
    throw new Error('MEDIA_CATALOG_RESTORE_SHA256_MISMATCH');
  }
  const rows = parseRows<T>(source);
  const backupPath = path.resolve(options.backupPath ?? `${sqlitePath}.pre-restore-${Date.now()}.json`);
  if (backupPath === sqlitePath || backupPath === sourcePath) throw new Error('MEDIA_CATALOG_RESTORE_BACKUP_CONFLICT');

  const leasePath = options.leasePath ?? `${sqlitePath}.authority.lock`;
  const lease = acquireMediaCatalogAuthorityLease(leasePath, 'operator-restore');
  let store: SqlitePhotoXStore;
  try {
    store = new SqlitePhotoXStore({ path: sqlitePath });
  } catch (error) {
    lease.release();
    throw error;
  }

  try {
    const catalog = new SqliteMediaIndexCatalog<T>(store);
    catalog.exportLegacyJson(backupPath);

    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.db.prepare('DELETE FROM photox_media_index').run();
      const insert = store.db.prepare('INSERT INTO photox_media_index(workspace_id,media_key,row_json,updated_at) VALUES(?,?,?,?)');
      const restoredAt = new Date().toISOString();
      for (const row of rows) insert.run(row.workspaceId, row.key, JSON.stringify(row), restoredAt);
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }

    const restored = catalog.listAll();
    if (JSON.stringify(restored) !== JSON.stringify(rows)) throw new Error('MEDIA_CATALOG_RESTORE_VERIFY_FAILED');
    return { restoredCount: restored.length, sourceSha256, backupPath };
  } finally {
    try {
      store.close();
    } finally {
      lease.release();
    }
  }
}
