import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { StorageAccount, StorageProviderDescriptor, StorageReplica, UpdateArtifact, UpdateManifest } from '@photosync/sdk-contracts';
import { compareVersions } from '@photosync/sdk-contracts';

export type UploadInput = {
  key: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  localPath: string;
};

export type UploadResult = {
  remoteFileId: string;
  remotePath?: string;
  webViewLink?: string;
  verified?: boolean;
};

export interface StorageProvider {
  descriptor(): StorageProviderDescriptor;
  listAccounts(): Promise<StorageAccount[]>;
  connectAccount?(): Promise<StorageAccount>;
  removeAccount?(accountId: string): Promise<void>;
  upload(accountId: string, input: UploadInput): Promise<UploadResult>;
  download?(accountId: string, remoteFileId: string): Promise<Response>;
  healthCheck?(accountId: string): Promise<boolean>;
}

export class StorageProviderRegistry {
  private readonly providers = new Map<string, StorageProvider>();

  register(provider: StorageProvider): this {
    const id = provider.descriptor().id;
    if (!id) throw new Error('Storage provider id is required');
    if (this.providers.has(id)) throw new Error(`Storage provider already registered: ${id}`);
    this.providers.set(id, provider);
    return this;
  }

  unregister(providerId: string): void { this.providers.delete(providerId); }
  get(providerId: string): StorageProvider | undefined { return this.providers.get(providerId); }
  list(): StorageProvider[] { return [...this.providers.values()]; }
  descriptors(): StorageProviderDescriptor[] { return this.list().map(p => p.descriptor()); }
}

export type ReplicaPolicy = {
  targetReplicas: number;
  distinctProviders?: boolean;
  minimumFreeBytes?: number;
};

export class ReplicaPlanner {
  constructor(private readonly registry: StorageProviderRegistry, private readonly policy: ReplicaPolicy = { targetReplicas: 2 }) {}

  async candidates(fileSize: number, existing: StorageReplica[] = []): Promise<Array<{ provider: StorageProvider; account: StorageAccount }>> {
    const usedAccounts = new Set(existing.filter(r => r.state === 'VERIFIED' || r.state === 'UPLOADED').map(r => `${r.providerId}:${r.accountId}`));
    const usedProviders = new Set(existing.filter(r => r.state === 'VERIFIED' || r.state === 'UPLOADED').map(r => r.providerId));
    const result: Array<{ provider: StorageProvider; account: StorageAccount }> = [];
    for (const provider of this.registry.list()) {
      if (this.policy.distinctProviders && usedProviders.has(provider.descriptor().id)) continue;
      for (const account of await provider.listAccounts()) {
        if (account.status !== 'ready') continue;
        if (usedAccounts.has(`${account.providerId}:${account.accountId}`)) continue;
        const free = account.freeBytes ?? Number.MAX_SAFE_INTEGER;
        if (free < fileSize + (this.policy.minimumFreeBytes || 0)) continue;
        result.push({ provider, account });
      }
    }
    return result.sort((a, b) => (b.account.freeBytes ?? 0) - (a.account.freeBytes ?? 0));
  }
}

export type UpdateCheck = { available: boolean; manifest: UpdateManifest; artifact?: UpdateArtifact; required: boolean };

export class DesktopUpdateClient {
  constructor(private readonly manifestUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async check(currentVersion: string, platform: 'desktop' = 'desktop', arch?: 'x64' | 'arm64' | 'universal'): Promise<UpdateCheck> {
    const response = await this.fetcher(this.manifestUrl, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`Update manifest HTTP ${response.status}`);
    const manifest = await response.json() as UpdateManifest;
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported update manifest schema: ${manifest.schemaVersion}`);
    const available = compareVersions(manifest.version, currentVersion) > 0;
    const required = Boolean(manifest.minimumSupportedVersion && compareVersions(currentVersion, manifest.minimumSupportedVersion) < 0);
    const artifact = manifest.artifacts.find(a => a.platform === platform && (!arch || !a.arch || a.arch === arch || a.arch === 'universal'));
    return { available, required, manifest, artifact };
  }

  async downloadAndVerify(artifact: UpdateArtifact, destination: string): Promise<string> {
    const response = await this.fetcher(artifact.url);
    if (!response.ok || !response.body) throw new Error(`Update download HTTP ${response.status}`);
    const writer = fs.createWriteStream(destination);
    await pipeline(response.body as never, writer);
    const hash = await new Promise<string>((resolve, reject) => {
      const h = crypto.createHash('sha256');
      const stream = fs.createReadStream(destination);
      stream.on('data', chunk => h.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(h.digest('hex')));
    });
    if (hash.toLowerCase() !== artifact.sha256.toLowerCase()) {
      await fs.promises.rm(destination, { force: true });
      throw new Error('Downloaded update failed SHA-256 verification');
    }
    return destination;
  }
}
