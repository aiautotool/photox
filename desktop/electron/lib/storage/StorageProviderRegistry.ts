import { StorageProvider, type StorageProviderId } from './StorageProvider.js';

/** Central extension point for all storage backends. */
export class StorageProviderRegistry {
  private readonly providers = new Map<StorageProviderId, StorageProvider>();

  register(provider: StorageProvider): this {
    if (this.providers.has(provider.id)) {
      throw new Error(`Storage provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  replace(provider: StorageProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  unregister(providerId: StorageProviderId): boolean {
    return this.providers.delete(providerId);
  }

  get(providerId: StorageProviderId): StorageProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown storage provider: ${providerId}`);
    return provider;
  }

  has(providerId: StorageProviderId): boolean {
    return this.providers.has(providerId);
  }

  list(): StorageProvider[] {
    return [...this.providers.values()];
  }
}
