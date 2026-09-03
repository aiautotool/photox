import type { StorageReplica } from '@photox/contracts';
import type { MediaCloudRepository } from './MediaCloudRepository';
import type { MediaCloudHealth, MediaCloudItem, MediaCloudItemSummary, MediaCloudQuery, ReplicaRequirement } from './types';

export class MediaCloudCatalog {
  constructor(
    private readonly repository: MediaCloudRepository,
    private readonly workspaceId: string,
    private readonly defaults: ReplicaRequirement = { targetReplicas: 2, requireDistinctAccounts: true, preferDistinctProviders: true },
  ) {
    if (!workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_REQUIRED');
  }

  async registerAsset(input: Omit<MediaCloudItem, 'workspaceId' | 'replicas' | 'updatedAt' | 'targetReplicas'> & { targetReplicas?: number; replicas?: MediaCloudItem['replicas'] }): Promise<MediaCloudItem> {
    const existing = await this.repository.get(this.workspaceId, input.assetId);
    const item: MediaCloudItem = {
      ...existing,
      ...input,
      workspaceId: this.workspaceId,
      targetReplicas: input.targetReplicas ?? existing?.targetReplicas ?? this.defaults.targetReplicas,
      replicas: input.replicas ?? existing?.replicas ?? [],
      updatedAt: new Date().toISOString(),
    };
    await this.repository.upsert(item);
    return item;
  }

  async attachReplica(assetId: string, replica: MediaCloudItem['replicas'][number]): Promise<MediaCloudItem> {
    const item = await this.require(assetId);
    const replicas = item.replicas.filter((row) => row.replicaId !== replica.replicaId);
    replicas.push(replica);
    const next = { ...item, replicas, updatedAt: new Date().toISOString() };
    await this.repository.upsert(next);
    return next;
  }

  async updateReplica(assetId: string, replicaId: string, patch: Partial<MediaCloudItem['replicas'][number]>): Promise<MediaCloudItem> {
    const item = await this.require(assetId);
    const replicas = item.replicas.map((row) => row.replicaId === replicaId ? { ...row, ...patch } : row);
    const next = { ...item, replicas, updatedAt: new Date().toISOString() };
    await this.repository.upsert(next);
    return next;
  }

  async removeReplica(assetId: string, replicaId: string): Promise<MediaCloudItem> {
    const item = await this.require(assetId);
    const next = { ...item, replicas: item.replicas.filter((row) => row.replicaId !== replicaId), updatedAt: new Date().toISOString() };
    await this.repository.upsert(next);
    return next;
  }

  async remove(assetId: string): Promise<void> {
    await this.repository.remove(this.workspaceId, assetId);
  }

  async get(assetId: string): Promise<MediaCloudItemSummary | null> {
    const item = await this.repository.get(this.workspaceId, assetId);
    return item ? this.summarize(item) : null;
  }

  async list(query: Omit<MediaCloudQuery, 'workspaceId'> = {}): Promise<MediaCloudItemSummary[]> {
    const items = await this.repository.list({ ...query, workspaceId: this.workspaceId });
    const rows = items.map((item) => this.summarize(item));
    return query.health ? rows.filter((row) => row.health === query.health) : rows;
  }

  summarize(item: MediaCloudItem): MediaCloudItemSummary {
    if (item.workspaceId !== this.workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_MISMATCH');
    const verified = item.replicas.filter((replica) => replica.state === 'VERIFIED');
    const providers = new Set(verified.map((replica) => replica.providerId));
    const accounts = new Set(verified.map((replica) => `${replica.providerId}:${replica.accountId ?? ''}`));
    return {
      workspaceId: item.workspaceId,
      assetId: item.assetId,
      filename: item.filename,
      targetReplicas: item.targetReplicas,
      verifiedReplicas: verified.length,
      providerCount: providers.size,
      accountCount: accounts.size,
      health: this.health(item),
      locations: item.replicas.map((replica) => ({
        providerId: replica.providerId,
        accountId: replica.accountId,
        providerDisplayName: replica.providerDisplayName,
        accountDisplayName: replica.accountDisplayName,
        state: replica.state,
        remoteFileId: replica.remoteFileId,
        webViewLink: replica.webViewLink,
      })),
    };
  }

  health(item: MediaCloudItem): MediaCloudHealth {
    if (item.workspaceId !== this.workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_MISMATCH');
    if (item.replicas.length === 0) return 'lost';
    const verified = item.replicas.filter((replica) => replica.state === 'VERIFIED');
    const failures = item.replicas.filter((replica) => replica.state === 'ERROR' || replica.state === 'BLOCKED' || replica.availability === 'offline');
    if (verified.length === 0) return failures.length > 0 ? 'lost' : 'unknown';
    if (verified.length < item.targetReplicas) return failures.length > 0 ? 'degraded' : 'under_replicated';
    if (this.defaults.requireDistinctAccounts) {
      const unique = new Set(verified.map((replica) => `${replica.providerId}:${replica.accountId ?? ''}`));
      if (unique.size < item.targetReplicas) return 'under_replicated';
    }
    return failures.length > 0 ? 'degraded' : 'protected';
  }

  private async require(assetId: string): Promise<MediaCloudItem> {
    const item = await this.repository.get(this.workspaceId, assetId);
    if (!item) throw new Error(`Unknown media asset: ${assetId}`);
    return item;
  }
}

export function toCloudReplica(assetId: string, replicaId: string, replica: StorageReplica): MediaCloudItem['replicas'][number] {
  return { ...replica, assetId, replicaId };
}
