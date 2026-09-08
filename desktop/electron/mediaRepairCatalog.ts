import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';

export type MediaRepairCatalogReplica = {
  state: string;
  accountId?: string;
  [key: string]: unknown;
};

export type MediaRepairCatalogRow = {
  workspaceId: string;
  key: string;
  cloud?: MediaRepairCatalogReplica;
  cloudReplicas?: MediaRepairCatalogReplica[];
  [key: string]: unknown;
};

function replicasOf(row: MediaRepairCatalogRow): MediaRepairCatalogReplica[] {
  if (row.cloudReplicas?.length) return row.cloudReplicas;
  return row.cloud ? [row.cloud] : [];
}

function withCatalog<T>(databasePath: string, run: (catalog: SqliteMediaIndexCatalog<MediaRepairCatalogRow>) => T): T {
  if (!databasePath) throw new Error('MEDIA_REPAIR_CATALOG_PATH_REQUIRED');
  const store = new SqlitePhotoXStore({ path: databasePath });
  try {
    return run(new SqliteMediaIndexCatalog<MediaRepairCatalogRow>(store));
  } finally {
    store.close();
  }
}

/**
 * Reads one exact tenant-scoped media row from the authoritative SQLite catalog.
 * Runtime repair must never fall back to legacy media-index.json after cutover.
 */
export function loadMediaRepairCatalogRow(
  databasePath: string,
  workspaceId: string,
  key: string,
): MediaRepairCatalogRow | null {
  if (!workspaceId) throw new Error('MEDIA_REPAIR_WORKSPACE_REQUIRED');
  if (!key) throw new Error('MEDIA_REPAIR_KEY_REQUIRED');
  return withCatalog(databasePath, catalog => catalog.get(workspaceId, key));
}

/**
 * Atomically merges repair replica progress into one exact media row. The catalog
 * patch holds BEGIN IMMEDIATE across read+write, so concurrent replica progress
 * cannot be lost and another workspace with the same media key is untouched.
 */
export function upsertMediaRepairCatalogReplica(
  databasePath: string,
  workspaceId: string,
  key: string,
  replica: MediaRepairCatalogReplica,
): MediaRepairCatalogRow {
  if (!workspaceId) throw new Error('MEDIA_REPAIR_WORKSPACE_REQUIRED');
  if (!key) throw new Error('MEDIA_REPAIR_KEY_REQUIRED');

  const updated = withCatalog(databasePath, catalog => catalog.patch(workspaceId, key, current => {
    const replicas = replicasOf(current).filter(existing => {
      if (replica.accountId) return existing.accountId !== replica.accountId;
      return existing.accountId != null;
    });
    replicas.push(replica);
    return {
      ...current,
      workspaceId,
      key,
      cloud: replicas[0],
      cloudReplicas: replicas,
    };
  }));

  if (!updated) throw new Error('MEDIA_REPAIR_NOT_FOUND');
  return updated;
}
