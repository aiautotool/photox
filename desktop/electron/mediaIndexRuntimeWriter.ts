import { createMediaIndexMutationRepository, type MediaIndexIdentity } from './mediaIndexMutationRepository.js';

export type RuntimeReplica = {
  state: string;
  accountId?: string;
  remoteFileId?: string;
  [key: string]: unknown;
};

export type RuntimeMediaIndexRow = MediaIndexIdentity & {
  videoProcessing?: string;
  videoError?: string;
  cloud?: RuntimeReplica;
  cloudReplicas?: RuntimeReplica[];
  [key: string]: unknown;
};

export type RuntimeVideoPatch<T extends RuntimeMediaIndexRow> = Omit<
  Partial<T>,
  'workspaceId' | 'key' | 'cloud' | 'cloudReplicas'
>;

export type MediaIndexRuntimeWriter<T extends RuntimeMediaIndexRow> = {
  ingest(row: T): Promise<T>;
  patchVideo(workspaceId: string, key: string, patch: RuntimeVideoPatch<T>): Promise<T | null>;
  upsertReplica(workspaceId: string, key: string, replica: RuntimeReplica): Promise<T | null>;
  remove(workspaceId: string, key: string): Promise<T | null>;
};

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

/**
 * Runtime-facing JSON catalog writer. The main process uses semantic operations
 * instead of whole-workspace read/replace snapshots, while the underlying
 * mutation repository keeps workspace + media identity serialized and retry-safe.
 */
export function createMediaIndexRuntimeWriter<T extends RuntimeMediaIndexRow>(
  filePath: string,
): MediaIndexRuntimeWriter<T> {
  const repository = createMediaIndexMutationRepository<T>(filePath);
  return {
    ingest: row => repository.append(row),
    patchVideo: (workspaceId, key, patch) => repository.patch(workspaceId, key, patch as Partial<T>),
    upsertReplica: (workspaceId, key, replica) => repository.patch(workspaceId, key, current => {
      const cloudReplicas = upsertReplicaList(replicasOf(current), replica);
      return {
        ...current,
        cloudReplicas,
        cloud: cloudReplicas[0],
      } as T;
    }),
    remove: (workspaceId, key) => repository.remove(workspaceId, key),
  };
}
