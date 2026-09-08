export type ReplicaHealthRecord = {
  state: string;
  accountId?: string;
  remoteFileId?: string;
  [key: string]: unknown;
};

export type ReplicaHealthIndexRow = {
  workspaceId?: string;
  key: string;
  deletion?: { state: 'deleting'; claimId: string; startedAt: string };
  cloud?: ReplicaHealthRecord;
  cloudReplicas?: ReplicaHealthRecord[];
  [key: string]: unknown;
};

export type ReplicaHealthPatch = {
  workspaceId: string;
  key: string;
  accountId?: string;
  remoteFileId?: string;
  replica: ReplicaHealthRecord;
};

function replicaIdentityMatches(replica: ReplicaHealthRecord, patch: ReplicaHealthPatch) {
  if (patch.accountId && replica.accountId !== patch.accountId) return false;
  if (patch.remoteFileId && replica.remoteFileId !== patch.remoteFileId) return false;
  return Boolean(patch.accountId || patch.remoteFileId);
}

/**
 * Applies verifier-only replica mutations onto the latest media index snapshot.
 * It intentionally never replaces a whole media row, so concurrent metadata,
 * processing, and replica additions written by the main process are preserved.
 * If the target replica disappeared meanwhile, the patch is skipped instead of
 * resurrecting a replica that another operation intentionally removed. Rows with
 * an active deletion tombstone are also skipped so an in-flight verifier cannot
 * race a delete and recreate provider state after remote deletion has started.
 */
export function applyReplicaHealthPatches<T extends ReplicaHealthIndexRow>(
  latestRows: T[],
  patches: ReplicaHealthPatch[],
): { rows: T[]; applied: number; skipped: number } {
  if (!patches.length) return { rows: latestRows, applied: 0, skipped: 0 };

  const rows = latestRows.map(row => ({ ...row })) as T[];
  let applied = 0;
  let skipped = 0;

  for (const patch of patches) {
    const rowIndex = rows.findIndex(row => row.key === patch.key && row.workspaceId === patch.workspaceId);
    if (rowIndex < 0) {
      skipped += 1;
      continue;
    }

    const row = rows[rowIndex];
    if (row.deletion?.state === 'deleting') {
      skipped += 1;
      continue;
    }
    const existingReplicas = row.cloudReplicas?.length ? row.cloudReplicas : row.cloud ? [row.cloud] : [];
    const replicaIndex = existingReplicas.findIndex(replica => replicaIdentityMatches(replica, patch));
    if (replicaIndex < 0) {
      skipped += 1;
      continue;
    }

    const replicas = existingReplicas.map(replica => ({ ...replica }));
    replicas[replicaIndex] = { ...replicas[replicaIndex], ...patch.replica };
    rows[rowIndex] = {
      ...row,
      cloudReplicas: replicas,
      cloud: replicas[0],
    } as T;
    applied += 1;
  }

  return { rows, applied, skipped };
}
