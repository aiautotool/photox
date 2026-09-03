import type { MediaCloudItem, MediaCloudQuery } from './types';

export interface MediaCloudRepository {
  get(workspaceId: string, assetId: string): Promise<MediaCloudItem | null>;
  list(query: MediaCloudQuery): Promise<MediaCloudItem[]>;
  upsert(item: MediaCloudItem): Promise<void>;
  remove(workspaceId: string, assetId: string): Promise<void>;
}

export class MemoryMediaCloudRepository implements MediaCloudRepository {
  private readonly items = new Map<string, MediaCloudItem>();

  private key(workspaceId: string, assetId: string): string {
    return `${workspaceId}\u0000${assetId}`;
  }

  async get(workspaceId: string, assetId: string): Promise<MediaCloudItem | null> {
    return structuredClone(this.items.get(this.key(workspaceId, assetId)) ?? null);
  }

  async list(query: MediaCloudQuery): Promise<MediaCloudItem[]> {
    let rows = [...this.items.values()].filter((item) => item.workspaceId === query.workspaceId);
    if (query.providerId) rows = rows.filter((item) => item.replicas.some((replica) => replica.providerId === query.providerId));
    if (query.accountId) rows = rows.filter((item) => item.replicas.some((replica) => replica.accountId === query.accountId));
    if (query.text) {
      const needle = query.text.toLowerCase();
      rows = rows.filter((item) => item.filename.toLowerCase().includes(needle) || item.assetId.toLowerCase().includes(needle));
    }
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(0, query.limit ?? rows.length);
    return rows.slice(offset, offset + limit).map((item) => structuredClone(item));
  }

  async upsert(item: MediaCloudItem): Promise<void> {
    if (!item.workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_REQUIRED');
    this.items.set(this.key(item.workspaceId, item.assetId), structuredClone(item));
  }

  async remove(workspaceId: string, assetId: string): Promise<void> {
    this.items.delete(this.key(workspaceId, assetId));
  }
}
