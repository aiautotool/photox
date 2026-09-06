import type { SqliteMediaIndexCatalog } from '@photox/persistence-sqlite';
import type { MediaIndexIdentity, MediaIndexMutationRepository } from './mediaIndexMutationRepository.js';

/**
 * Async adapter from the Desktop runtime mutation contract to the transactional
 * SQLite media catalog. The runtime writer can switch storage backends without
 * changing ingest/video/replica/delete semantics and without dual-writing JSON.
 */
export function createSqliteMediaIndexMutationRepository<
  T extends MediaIndexIdentity & Record<string, unknown>,
>(catalog: SqliteMediaIndexCatalog<T>): MediaIndexMutationRepository<T> {
  return {
    async append(row) {
      return catalog.append(row);
    },

    async patch(workspaceId, key, patch) {
      return catalog.patch(workspaceId, key, current => {
        const candidate = typeof patch === 'function'
          ? patch(current)
          : ({ ...current, ...patch } as T);
        return {
          ...candidate,
          workspaceId,
          key,
        } as T;
      });
    },

    async remove(workspaceId, key) {
      return catalog.remove(workspaceId, key);
    },
  };
}
