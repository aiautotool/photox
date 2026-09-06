import { existsSync } from 'node:fs';
import path from 'node:path';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore, type SqliteMediaIndexIdentity } from '@photox/persistence-sqlite';
import { acquireMediaCatalogAuthorityLease } from './mediaCatalogAuthorityLease.js';

export type OfflineMediaCatalogExportOptions = {
  sqlitePath: string;
  targetPath: string;
  leasePath?: string;
};

export type OfflineMediaCatalogExportResult = {
  targetPath: string;
  exportedCount: number;
  sha256: string;
};

/**
 * Exports the authoritative SQLite media catalog to an atomic legacy-compatible
 * JSON artifact for operator rollback/recovery. This is deliberately offline:
 * the same authority lease used by Desktop runtime is acquired first, so export
 * refuses to run while Desktop owns the catalog and Desktop cannot start while
 * the export is in progress.
 */
export function exportMediaCatalogOffline<T extends SqliteMediaIndexIdentity & Record<string, unknown>>(
  options: OfflineMediaCatalogExportOptions,
): OfflineMediaCatalogExportResult {
  if (!options.sqlitePath.trim()) throw new Error('MEDIA_CATALOG_EXPORT_SQLITE_PATH_REQUIRED');
  if (!options.targetPath.trim()) throw new Error('MEDIA_CATALOG_EXPORT_TARGET_PATH_REQUIRED');
  const sqlitePath = path.resolve(options.sqlitePath);
  const targetPath = path.resolve(options.targetPath);
  if (sqlitePath === targetPath) throw new Error('MEDIA_CATALOG_EXPORT_TARGET_CONFLICT');
  if (!existsSync(sqlitePath)) throw new Error('MEDIA_CATALOG_EXPORT_SQLITE_MISSING');

  const leasePath = options.leasePath ?? `${sqlitePath}.authority.lock`;
  const lease = acquireMediaCatalogAuthorityLease(leasePath, 'operator-export');
  let store: SqlitePhotoXStore;
  try {
    store = new SqlitePhotoXStore({ path: sqlitePath });
  } catch (error) {
    lease.release();
    throw error;
  }

  try {
    const catalog = new SqliteMediaIndexCatalog<T>(store);
    const result = catalog.exportLegacyJson(targetPath);
    return { targetPath, ...result };
  } finally {
    try {
      store.close();
    } finally {
      lease.release();
    }
  }
}
