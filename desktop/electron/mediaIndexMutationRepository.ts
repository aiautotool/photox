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
      await mutateSerializedJsonArray<T>(filePath, rows => {
        if (rows.some(item => sameIdentity(item, identity.workspaceId, identity.key))) {
          throw new Error('MEDIA_INDEX_DUPLICATE_KEY');
        }
        return [...rows, normalized];
      }, { tempLabel: 'append-media' });
      return normalized;
    },

    async patch(workspaceId, key, patch) {
      const identity = normalizeIdentity(workspaceId, key);
      let updated: T | null = null;
      await mutateSerializedJsonArray<T>(filePath, rows => rows.map(row => {
        if (!sameIdentity(row, identity.workspaceId, identity.key)) return row;
        const candidate = typeof patch === 'function'
          ? patch(row)
          : ({ ...row, ...patch } as T);
        updated = {
          ...candidate,
          workspaceId: identity.workspaceId,
          key: identity.key,
        } as T;
        return updated;
      }), { tempLabel: 'patch-media' });
      return updated;
    },

    async remove(workspaceId, key) {
      const identity = normalizeIdentity(workspaceId, key);
      let removed: T | null = null;
      await mutateSerializedJsonArray<T>(filePath, rows => rows.filter(row => {
        if (!sameIdentity(row, identity.workspaceId, identity.key)) return true;
        removed = row;
        return false;
      }), { tempLabel: 'remove-media' });
      return removed;
    },
  };
}
