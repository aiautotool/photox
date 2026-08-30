export * from './storage/StorageProvider.js';
export * from './storage/StorageProviderRegistry.js';
export * from './storage/CallbackStorageProvider.js';
export * from './storage/ReplicationService.js';
export * from './api/MobileApiService.js';

import { MobileApiService, type MobileApiDependencies } from './api/MobileApiService.js';
import { ReplicationService, type ReplicationPolicy } from './storage/ReplicationService.js';
import { StorageProviderRegistry } from './storage/StorageProviderRegistry.js';
import type { StorageProvider } from './storage/StorageProvider.js';

/**
 * Composition root for the desktop backend.
 * main.ts should eventually talk to this facade instead of importing provider SDKs directly.
 */
export class PhotoSyncDesktopLib {
  readonly storage = new StorageProviderRegistry();
  readonly replication: ReplicationService;
  readonly mobileApi: MobileApiService;

  constructor(options: {
    mobileApi: MobileApiDependencies;
    apiPort?: number;
    replicationPolicy?: ReplicationPolicy;
  }) {
    this.replication = new ReplicationService(this.storage, options.replicationPolicy);
    this.mobileApi = new MobileApiService(this.storage, options.mobileApi, options.apiPort);
  }

  registerStorageProvider(provider: StorageProvider): this {
    this.storage.register(provider);
    return this;
  }
}
