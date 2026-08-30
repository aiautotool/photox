import type { StorageObject, StorageReplica } from '@photox/contracts';
import { MediaCloudCatalog } from './MediaCloudCatalog';

export class ReplicationCatalogBridge {
  constructor(private readonly catalog: MediaCloudCatalog) {}

  async queued(assetId: string, replicaId: string, providerId: string, accountId?: string): Promise<void> {
    await this.catalog.attachReplica(assetId, {
      replicaId,
      assetId,
      providerId,
      accountId,
      state: 'QUEUED',
    });
  }

  async uploading(assetId: string, replicaId: string): Promise<void> {
    await this.catalog.updateReplica(assetId, replicaId, { state: 'UPLOADING' });
  }

  async uploaded(assetId: string, replicaId: string, object: StorageObject): Promise<void> {
    await this.catalog.updateReplica(assetId, replicaId, {
      ...object,
      state: 'UPLOADED',
      uploadedAt: new Date().toISOString(),
    });
  }

  async verified(assetId: string, replicaId: string, patch: Partial<StorageReplica> = {}): Promise<void> {
    await this.catalog.updateReplica(assetId, replicaId, {
      ...patch,
      state: 'VERIFIED',
      availability: 'online',
      verifiedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
    });
  }

  async failed(assetId: string, replicaId: string, error: unknown): Promise<void> {
    await this.catalog.updateReplica(assetId, replicaId, {
      state: 'ERROR',
      availability: 'unknown',
      lastErrorAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
