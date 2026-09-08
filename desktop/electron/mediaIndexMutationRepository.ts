import { mutateSerializedJsonArray } from './mediaIndexSerializedStore.js';

export type MediaIndexIdentity = {
  workspaceId: string;
  key: string;
};

export type MediaIndexMutationRepository<T extends MediaIndexIdentity> = {
  append(row: T): Promise<T>;
  patch(
    workspaceId: string,
    key: string,
    patch: Partial<T> | ((current: T) => T),
  ): Promise<T | null>;
  remove(workspaceId: string, key: string): Promise<T | null>;
};

function normalizeIdentity(workspaceId: string, key: string) {
  const normalizedWorkspaceId = String(workspaceId || '').trim();
  const normalizedKey = String(key || '').trim();
  if (!normalizedWorkspaceId) throw new Error('MEDIA_INDEX_WORKSPACE_REQUIRED');
  if (!normalizedKey) throw new Error('MEDIA_INDEX_KEY_REQUIRED');
  return { workspaceId: normalizedWorkspaceId, key: normalizedKey };
}

function sameIdentity(row: MediaIndexIdentity, workspaceId: string, key: string) {
  return row.workspaceId === workspaceId && row.key === key;
}

/**
 * Exact-identity media-index mutation boundary used while the durable catalog is
 * still JSON-backed. Callers never submit a whole stale workspace snapshot:
 * append/patch/remove always execute against the latest serialized array.
 */
export function createMediaIndexMutationRepository<T extends MediaIndexIdentity>(
  filePath: string,
): MediaIndexMutationRepository<T> {
  return {
    async append(row) {
      const identity = normalizeIdentity(row.workspaceId, row.key);
      const normalized = { ...row, ...identity } as T;
      const committed = await mutateSerializedJsonArray<T>(filePath, rows => {
        if (rows.some(item => sameIdentity(item, identity.workspaceId, identity.key))) {
          throw new Error('MEDIA_INDEX_DUPLICATE_KEY');
        }
        return [...rows, normalized];
      }, { tempLabel: 'append-media' });
      return committed.find(item => sameIdentity(item, identity.workspaceId, identity.key)) ?? normalized;
    },

    async patch(workspaceId, key, patch) {
      const identity = normalizeIdentity(workspaceId, key);
      let matchedOnCommittedAttempt = false;
      const committed = await mutateSerializedJsonArray<T>(filePath, rows => {
        // mutateSerializedJsonArray may invoke this callback again after detecting
        // an external writer. Reset attempt-local state so a match from a stale
        // attempt can never be reported as a successful committed patch.
        matchedOnCommittedAttempt = false;
        return rows.map(row => {
          if (!sameIdentity(row, identity.workspaceId, identity.key)) return row;
          matchedOnCommittedAttempt = true;
          const candidate = typeof patch === 'function'
            ? patch(row)
            : ({ ...row, ...patch } as T);
          return {
            ...candidate,
            workspaceId: identity.workspaceId,
            key: identity.key,
          } as T;
        });
      }, { tempLabel: 'patch-media' });
      if (!matchedOnCommittedAttempt) return null;
      return committed.find(item => sameIdentity(item, identity.workspaceId, identity.key)) ?? null;
    },

    async remove(workspaceId, key) {
      const identity = normalizeIdentity(workspaceId, key);
      let removedOnCommittedAttempt: T | null = null;
      await mutateSerializedJsonArray<T>(filePath, rows => {
        // Retry callbacks must not retain the removed row from an earlier stale
        // attempt. Only the attempt that actually commits is authoritative.
        removedOnCommittedAttempt = null;
        return rows.filter(row => {
          if (!sameIdentity(row, identity.workspaceId, identity.key)) return true;
          removedOnCommittedAttempt = row;
          return false;
        });
      }, { tempLabel: 'remove-media' });
      return removedOnCommittedAttempt;
    },
  };
}
