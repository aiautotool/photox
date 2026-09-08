import { createMediaIndexMutationRepository, type MediaIndexIdentity, type MediaIndexMutationRepository } from './mediaIndexMutationRepository.js';

export type RuntimeReplica = {
  state: string;
  accountId?: string;
  remoteFileId?: string;
  [key: string]: unknown;
};

export type RuntimeDeletionClaim = {
  state: 'deleting';
  claimId: string;
  startedAt: string;
};

export type RuntimeMediaIndexRow = MediaIndexIdentity & {
  videoProcessing?: string;
  videoError?: string;
  cloud?: RuntimeReplica;
  cloudReplicas?: RuntimeReplica[];
  deletion?: RuntimeDeletionClaim;
  [key: string]: unknown;
};

export type RuntimeVideoPatch<T extends RuntimeMediaIndexRow> = Omit<
  Partial<T>,
  'workspaceId' | 'key' | 'cloud' | 'cloudReplicas' | 'deletion'
>;

export type MediaIndexRuntimeWriter<T extends RuntimeMediaIndexRow> = {
  ingest(row: T): Promise<T>;
  patchVideo(workspaceId: string, key: string, patch: RuntimeVideoPatch<T>): Promise<T | null>;
  upsertReplica(workspaceId: string, key: string, replica: RuntimeReplica): Promise<T | null>;
  syncReplicas(workspaceId: string, key: string, replicas: RuntimeReplica[]): Promise<T | null>;
  claimDeletion(workspaceId: string, key: string, claimId: string, startedAt?: string): Promise<T | null>;
  clearDeletion(workspaceId: string, key: string, claimId: string): Promise<T | null>;
  removeClaimed(workspaceId: string, key: string, claimId: string): Promise<T | null>;
  remove(workspaceId: string, key: string): Promise<T | null>;
};

export type MediaIndexRuntimeWriterBackend<T extends RuntimeMediaIndexRow> =
  | string
  | MediaIndexMutationRepository<T>;

function replicasOf(row: RuntimeMediaIndexRow): RuntimeReplica[] {
  if (row.cloudReplicas?.length) return row.cloudReplicas;
  return row.cloud ? [row.cloud] : [];
}

function upsertReplicaList(current: RuntimeReplica[], incoming: RuntimeReplica) {
  const replicas = current.map(replica => ({ ...replica }));
  if (incoming.accountId) {
    const index = replicas.findIndex(replica => replica.accountId === incoming.accountId);
    if (index >= 0) replicas[index] = { ...replicas[index], ...incoming };
    else replicas.push({ ...incoming });
    return replicas;
  }

  // Account-less entries are transient queue/block markers. Keep at most one so
  // repeated background retries cannot grow an unbounded list of placeholders.
  const pendingIndex = replicas.findIndex(replica => !replica.accountId);
  if (pendingIndex >= 0) replicas[pendingIndex] = { ...replicas[pendingIndex], ...incoming };
  else replicas.push({ ...incoming });
  return replicas;
}

function syncReplicaList(current: RuntimeReplica[], incoming: RuntimeReplica[]) {
  // Account-bound replicas are durable provider state. Merge an incoming runtime
  // snapshot into the latest committed row instead of replacing it, because the
  // caller may have built that snapshot before another account finished upload or
  // verification. This preserves concurrent provider progress.
  const merged = current.filter(replica => replica.accountId).map(replica => ({ ...replica }));
  for (const replica of incoming.filter(item => item.accountId)) {
    const index = merged.findIndex(item => item.accountId === replica.accountId);
    if (index >= 0) merged[index] = { ...merged[index], ...replica };
    else merged.push({ ...replica });
  }

  // Queue/block markers have no provider identity and are not durable replicas.
  // The newest caller snapshot owns this marker: keep at most its last marker, or
  // clear an older marker once the caller no longer reports a queued condition.
  const pending = [...incoming].reverse().find(replica => !replica.accountId);
  if (pending) merged.push({ ...pending });
  return merged;
}

/**
 * Runtime-facing media catalog writer. While JSON remains supported during the
 * cutover window callers may pass a legacy file path; the production SQLite
 * backend can inject the same exact-identity mutation repository contract.
 * Semantic operations therefore stay unchanged across the storage cutover and
 * there is never a need to dual-write JSON and SQLite.
 *
 * A deletion claim is an authoritative tombstone. Once present, background video
 * and replica writers are fail-closed for that row until the delete either commits
 * or explicitly clears its own claim for retry/recovery.
 */
export function createMediaIndexRuntimeWriter<T extends RuntimeMediaIndexRow>(
  backend: MediaIndexRuntimeWriterBackend<T>,
): MediaIndexRuntimeWriter<T> {
  const repository = typeof backend === 'string'
    ? createMediaIndexMutationRepository<T>(backend)
    : backend;
  return {
    ingest: row => repository.append(row),
    patchVideo: (workspaceId, key, patch) => repository.patch(workspaceId, key, current => {
      if (current.deletion) return current;
      return { ...current, ...patch, workspaceId, key } as T;
    }),
    upsertReplica: (workspaceId, key, replica) => repository.patch(workspaceId, key, current => {
      if (current.deletion) return current;
      const cloudReplicas = upsertReplicaList(replicasOf(current), replica);
      return {
        ...current,
        cloudReplicas,
        cloud: cloudReplicas[0],
      } as T;
    }),
    syncReplicas: (workspaceId, key, replicas) => repository.patch(workspaceId, key, current => {
      if (current.deletion) return current;
      const cloudReplicas = syncReplicaList(replicasOf(current), replicas);
      return {
        ...current,
        cloudReplicas,
        cloud: cloudReplicas[0],
      } as T;
    }),
    claimDeletion: (workspaceId, key, claimId, startedAt = new Date().toISOString()) => repository.patch(workspaceId, key, current => {
      if (current.deletion) return current;
      return { ...current, deletion: { state: 'deleting', claimId, startedAt } } as T;
    }),
    clearDeletion: (workspaceId, key, claimId) => repository.patch(workspaceId, key, current => {
      if (current.deletion?.claimId !== claimId) return current;
      const next = { ...current } as T;
      delete next.deletion;
      return next;
    }),
    removeClaimed: async (workspaceId, key, claimId) => {
      let ownsClaim = false;
      const checked = await repository.patch(workspaceId, key, current => {
        ownsClaim = current.deletion?.claimId === claimId;
        return current;
      });
      if (!checked || !ownsClaim) return null;
      return repository.remove(workspaceId, key);
    },
    remove: (workspaceId, key) => repository.remove(workspaceId, key),
  };
}
