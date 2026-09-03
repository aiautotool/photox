import type { VideoMediaRecord, VideoMediaRepository } from './types';

const keyFor = (workspaceId:string, assetId:string) => `${workspaceId}\u0000${assetId}`;

export class MemoryVideoMediaRepository implements VideoMediaRepository {
  private readonly rows = new Map<string, VideoMediaRecord>();
  async get(workspaceId:string, assetId:string){ return this.rows.get(keyFor(workspaceId, assetId)) ?? null; }
  async save(record:VideoMediaRecord){
    if (!record.workspaceId) throw new Error('VIDEO_MEDIA_WORKSPACE_REQUIRED');
    this.rows.set(keyFor(record.workspaceId, record.assetId), record);
  }
  async remove(workspaceId:string, assetId:string){ this.rows.delete(keyFor(workspaceId, assetId)); }
}
