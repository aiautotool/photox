import type { MediaCloudItem, MediaCloudQuery } from './types';

export interface MediaCloudRepository {
  get(assetId: string): Promise<MediaCloudItem | null>;
  list(query?: MediaCloudQuery): Promise<MediaCloudItem[]>;
  upsert(item: MediaCloudItem): Promise<void>;
  remove(assetId: string): Promise<void>;
}

export class MemoryMediaCloudRepository implements MediaCloudRepository {
  private readonly items = new Map<string, MediaCloudItem>();

  async get(assetId: string): Promise<MediaCloudItem | null> {
    return this.items.get(assetId) ?? null;
  }

  async list(query: MediaCloudQuery = {}): Promise<MediaCloudItem[]> {
    let rows = [...this.items.values()];
    if (query.providerId) rows = rows.filter((item) => item.replicas.some((replica) => replica.providerId === query.providerId));
    if (query.accountId) rows = rows.filter((item) => item.replicas.some((replica) => replica.accountId === query.accountId));
    if (query.text) {
      const needle = query.text.toLowerCase();
      rows = rows.filter((item) => item.filename.toLowerCase().includes(needle) || item.assetId.toLowerCase().includes(needle));
    }
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(0, query.limit ?? rows.length);
    return rows.slice(offset, offset + limit);
  }

  async upsert(item: MediaCloudItem): Promise<void> {
    this.items.set(item.assetId, structuredClone(item));
  }

  async remove(assetId: string): Promise<void> {
    this.items.delete(assetId);
  }
}
