import type { MediaAsset, StorageProvider } from '@photox/contracts';
import { MediaIndex } from '@photox/media';
import type { MediaCloudCatalog } from '@photox/media-cloud';
import type { MediaApiController } from '@photox/media-api';
import type { MediaDeliveryResolver } from '@photox/media-delivery';
import type { IntegrityVerificationEngine } from '@photox/integrity';
import type { DurableJobQueue } from '@photox/jobs';
import type { ReconciliationEngine } from '@photox/reconciliation';
import type { CatalogBackupService, CatalogRecoveryService } from '@photox/catalog-backup';
import type { AdvancedReplicaPolicyEngine, ProviderScoringEngine } from '@photox/replica-policy';
import type { VideoMediaService } from '@photox/video-media';
import { EventBus, SyncEngine, type SyncProcessor } from '@photox/sync';
import { ReplicationService, StoragePolicyEngine, StorageProviderRegistry, type StoragePolicy } from '@photox/storage';
import { UpdateClient } from '@photox/update-core';

export interface PhotoXDesktopServices {
  mediaCloud?: MediaCloudCatalog;
  mediaApi?: MediaApiController;
  delivery?: MediaDeliveryResolver;
  integrity?: IntegrityVerificationEngine;
  jobs?: DurableJobQueue;
  reconciliation?: ReconciliationEngine;
  catalogBackup?: CatalogBackupService;
  catalogRecovery?: CatalogRecoveryService;
  replicaPolicy?: AdvancedReplicaPolicyEngine;
  providerScoring?: ProviderScoringEngine;
  video?: VideoMediaService;
}

export interface PhotoXDesktopSDKOptions {
  storagePolicy?: StoragePolicy;
  syncProcessor?: SyncProcessor;
  updateManifestUrl?: string;
  services?: PhotoXDesktopServices;
}

export class PhotoXDesktopSDK {
  readonly events = new EventBus();
  readonly media = new MediaIndex();
  readonly storage = new StorageProviderRegistry();
  readonly storagePolicy: StoragePolicyEngine;
  readonly replication: ReplicationService;
  readonly sync: SyncEngine;
  readonly updates?: UpdateClient;
  readonly services: PhotoXDesktopServices;

  constructor(options: PhotoXDesktopSDKOptions = {}) {
    this.storagePolicy = new StoragePolicyEngine(this.storage, options.storagePolicy);
    this.replication = new ReplicationService(this.storagePolicy);
    this.sync = new SyncEngine(undefined, this.events, options.syncProcessor);
    this.services = options.services ?? {};
    if (options.updateManifestUrl) this.updates = new UpdateClient(options.updateManifestUrl);
  }

  registerStorageProvider(provider: StorageProvider): this {
    this.storage.register(provider);
    return this;
  }

  use<K extends keyof PhotoXDesktopServices>(key: K, service: NonNullable<PhotoXDesktopServices[K]>): this {
    this.services[key] = service;
    return this;
  }

  async ingest(asset: MediaAsset): Promise<MediaAsset> {
    this.media.upsert(asset);
    this.sync.enqueue(asset);
    return asset;
  }

  async ensureReplicas(assetId: string, policy?: StoragePolicy): Promise<MediaAsset> {
    const asset = this.media.get(assetId);
    if (!asset) throw new Error(`Unknown media asset: ${assetId}`);
    asset.replicas = await this.replication.replicate(asset, policy);
    this.media.upsert(asset);
    return asset;
  }
}
