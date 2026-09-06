import path from 'node:path';
import {
  SqliteMediaIndexCatalog,
  SqlitePhotoXStore,
  type MediaIndexJsonMigrationResult,
} from '@photox/persistence-sqlite';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';
import { createMediaIndexRuntimeWriter, type MediaIndexRuntimeWriter } from './mediaIndexRuntimeWriter.js';
import { createSqliteMediaIndexMutationRepository } from './mediaIndexSqliteRepository.js';
import { acquireMediaCatalogAuthorityLease } from './mediaCatalogAuthorityLease.js';

export type MediaCatalogBackendHealth = {
  kind: 'sqlite';
  schemaVersion: 1;
  migrationStatus: MediaIndexJsonMigrationResult['status'];
  rowCount: number;
  importedRowCount: number;
  backupPath?: string;
  sourceSha256?: string;
};

export type ActiveMediaCatalogBackend<T extends RuntimeMediaIndexRow> = {
  kind: 'sqlite';
  catalog: SqliteMediaIndexCatalog<T>;
  writer: MediaIndexRuntimeWriter<T>;
  /** Live health snapshot. rowCount must reflect current SQLite authority, not startup state. */
  readonly health: MediaCatalogBackendHealth;
  get(workspaceId: string, key: string): T | null;
  listWorkspace(workspaceId: string): T[];
  listAll(): T[];
  close(): void;
};

export type OpenMediaCatalogBackendOptions = {
  sqlitePath: string;
  legacyJsonPath: string;
  backupPath?: string;
  authorityLeasePath?: string;
};

function assertCatalogRows<T extends RuntimeMediaIndexRow>(rows: T[]): void {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') throw new Error(`MEDIA_CATALOG_ROW_INVALID:${index}`);
    if (typeof row.workspaceId !== 'string' || !row.workspaceId.trim()) {
      throw new Error(`MEDIA_CATALOG_WORKSPACE_REQUIRED:${index}`);
    }
    if (typeof row.key !== 'string' || !row.key.trim()) {
      throw new Error(`MEDIA_CATALOG_KEY_REQUIRED:${index}`);
    }
    const identity = `${row.workspaceId}\u0000${row.key}`;
    if (seen.has(identity)) throw new Error(`MEDIA_CATALOG_DUPLICATE_IDENTITY:${row.workspaceId}:${row.key}`);
    seen.add(identity);
  }
}

/**
 * Opens the Desktop/Web media catalog at a single authority boundary.
 *
 * The process authority lease is acquired before SQLite opens. Offline recovery
 * tooling takes the same lease, which prevents export from racing active runtime
 * writes and prevents Desktop from starting while an offline export is running.
 *
 * The legacy JSON file is imported exactly once by SqliteMediaIndexCatalog. The
 * backend is not returned until the migration marker and imported row count have
 * been validated. Runtime callers therefore never enter a JSON+SQLite dual-write
 * state: after this function succeeds, SQLite is the sole active read/write
 * authority for the process.
 */
export function openActiveMediaCatalogBackend<T extends RuntimeMediaIndexRow>(
  options: OpenMediaCatalogBackendOptions,
): ActiveMediaCatalogBackend<T> {
  if (!options.sqlitePath) throw new Error('MEDIA_CATALOG_SQLITE_PATH_REQUIRED');
  if (!options.legacyJsonPath) throw new Error('MEDIA_CATALOG_LEGACY_PATH_REQUIRED');

  const authorityLeasePath = options.authorityLeasePath ?? `${options.sqlitePath}.authority.lock`;
  const authorityLease = acquireMediaCatalogAuthorityLease(authorityLeasePath, 'desktop-runtime');
  let store: SqlitePhotoXStore;
  try {
    store = new SqlitePhotoXStore({ path: options.sqlitePath });
  } catch (error) {
    authorityLease.release();
    throw error;
  }

  try {
    const catalog = new SqliteMediaIndexCatalog<T>(store);
    const backupPath = options.backupPath
      ?? path.join(path.dirname(options.legacyJsonPath), 'media-index.pre-sqlite-v1.json');
    const migration = catalog.migrateLegacyJson(options.legacyJsonPath, backupPath);
    const rows = catalog.listAll();
    assertCatalogRows(rows);

    const marker = catalog.getImportMarker();
    if (migration.status !== 'SOURCE_MISSING') {
      if (!marker) throw new Error('MEDIA_CATALOG_MIGRATION_MARKER_MISSING');
      if (marker.version !== 1) throw new Error(`MEDIA_CATALOG_MIGRATION_MARKER_UNSUPPORTED:${marker.version}`);
      // Runtime rows may legitimately be added after the one-time import. The
      // imported count is therefore a lower bound, not an equality check. Fewer
      // rows than the durable marker claims means data disappeared and activation
      // must fail closed.
      if (marker.importedCount > rows.length) {
        throw new Error(`MEDIA_CATALOG_MIGRATION_COUNT_MISMATCH:${marker.importedCount}:${rows.length}`);
      }
      if (migration.sourceSha256 && marker.sourceSha256 !== migration.sourceSha256) {
        throw new Error('MEDIA_CATALOG_MIGRATION_SHA_MISMATCH');
      }
    }

    const repository = createSqliteMediaIndexMutationRepository(catalog);
    const writer = createMediaIndexRuntimeWriter(repository);
    const importedRowCount = marker?.importedCount ?? 0;
    const healthBase = {
      kind: 'sqlite' as const,
      schemaVersion: 1 as const,
      migrationStatus: migration.status,
      importedRowCount,
      backupPath: marker?.backupPath ?? migration.backupPath,
      sourceSha256: marker?.sourceSha256 ?? migration.sourceSha256,
    };
    let closed = false;

    return {
      kind: 'sqlite',
      catalog,
      writer,
      get health(): MediaCatalogBackendHealth {
        return { ...healthBase, rowCount: catalog.listAll().length };
      },
      get: (workspaceId, key) => catalog.get(workspaceId, key),
      listWorkspace: workspaceId => catalog.listWorkspace(workspaceId),
      listAll: () => catalog.listAll(),
      close: () => {
        if (closed) return;
        store.close();
        authorityLease.release();
        closed = true;
      },
    };
  } catch (error) {
    store.close();
    authorityLease.release();
    throw error;
  }
}
