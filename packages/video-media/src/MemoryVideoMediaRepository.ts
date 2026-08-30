import type { VideoMediaRecord, VideoMediaRepository } from './types';

export class MemoryVideoMediaRepository implements VideoMediaRepository {
  private readonly rows = new Map<string, VideoMediaRecord>();
  async get(assetId:string){ return this.rows.get(assetId) ?? null; }
  async save(record:VideoMediaRecord){ this.rows.set(record.assetId, record); }
  async remove(assetId:string){ this.rows.delete(assetId); }
}
