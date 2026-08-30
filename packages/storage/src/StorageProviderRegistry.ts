import type { StorageProvider } from '@photox/contracts';

export class StorageProviderRegistry {
  private readonly providers = new Map<string, StorageProvider>();

  register(provider: StorageProvider): this {
    if (!provider.id) throw new Error('Storage provider id is required');
    if (this.providers.has(provider.id)) throw new Error(`Storage provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  replace(provider: StorageProvider): this { this.providers.set(provider.id, provider); return this; }
  unregister(providerId:string): boolean { return this.providers.delete(providerId); }
  get(providerId:string): StorageProvider | undefined { return this.providers.get(providerId); }
  require(providerId:string): StorageProvider { const p=this.get(providerId); if(!p) throw new Error(`Unknown storage provider: ${providerId}`); return p; }
  list(): StorageProvider[] { return [...this.providers.values()]; }
}
