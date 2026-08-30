import type { MediaAsset, StorageProvider } from '@photox/contracts';
import { MediaIndex } from '@photox/media';
import { EventBus, SyncEngine, type SyncProcessor } from '@photox/sync';
import { ReplicationService, StoragePolicyEngine, StorageProviderRegistry, type StoragePolicy } from '@photox/storage';
import { UpdateClient } from '@photox/update-core';

export interface PhotoXDesktopSDKOptions { storagePolicy?:StoragePolicy; syncProcessor?:SyncProcessor; updateManifestUrl?:string; }
export class PhotoXDesktopSDK {
  readonly events=new EventBus();
  readonly media=new MediaIndex();
  readonly storage=new StorageProviderRegistry();
  readonly storagePolicy:StoragePolicyEngine;
  readonly replication:ReplicationService;
  readonly sync:SyncEngine;
  readonly updates?:UpdateClient;
  constructor(options:PhotoXDesktopSDKOptions={}) { this.storagePolicy=new StoragePolicyEngine(this.storage,options.storagePolicy); this.replication=new ReplicationService(this.storagePolicy); this.sync=new SyncEngine(undefined,this.events,options.syncProcessor); if(options.updateManifestUrl)this.updates=new UpdateClient(options.updateManifestUrl); }
  registerStorageProvider(provider:StorageProvider):this { this.storage.register(provider); return this; }
  async ingest(asset:MediaAsset):Promise<MediaAsset>{this.media.upsert(asset); this.sync.enqueue(asset); return asset;}
  async ensureReplicas(assetId:string,policy?:StoragePolicy):Promise<MediaAsset>{const asset=this.media.get(assetId); if(!asset)throw new Error(`Unknown media asset: ${assetId}`); asset.replicas=await this.replication.replicate(asset,policy); this.media.upsert(asset); return asset;}
}
