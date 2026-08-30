import fs from 'node:fs/promises';
import { StorageProviderRegistry } from './StorageProviderRegistry.js';
import type { StorageAccount, StorageObject } from './StorageProvider.js';

export type ReplicaState = 'QUEUED' | 'UPLOADING' | 'VERIFIED' | 'ERROR';

export type ReplicaRecord = {
  providerId: string;
  accountId?: string;
  state: ReplicaState;
  remoteFileId?: string;
  remotePath?: string;
  webViewLink?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  message?: string;
};

export type ReplicationAsset = {
  key: string;
  filename: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  replicas: ReplicaRecord[];
};

export type ReplicationPolicy = {
  targetReplicas: number;
  /** Keep each replica on a different account by default. */
  distinctAccounts?: boolean;
  /** Keep each replica on a different provider when possible. */
  preferDistinctProviders?: boolean;
  /** Bytes intentionally left free in an account. */
  reserveBytes?: number;
};

export type ReplicationResult = {
  asset: ReplicationAsset;
  satisfied: boolean;
};

function accountKey(account: StorageAccount) {
  return `${account.providerId}:${account.accountId}`;
}

/**
 * Places replicas across registered providers without knowing provider-specific APIs.
 * Adding a new backend therefore does not require changes in this class.
 */
export class ReplicationService {
  constructor(
    private readonly registry: StorageProviderRegistry,
    private readonly policy: ReplicationPolicy = { targetReplicas: 2, distinctAccounts: true, preferDistinctProviders: true, reserveBytes: 100 * 1024 * 1024 },
  ) {}

  async replicate(input: ReplicationAsset): Promise<ReplicationResult> {
    await fs.access(input.filePath);

    const verified = input.replicas.filter(r => r.state === 'VERIFIED' && r.accountId);
    if (verified.length >= this.policy.targetReplicas) return { asset: input, satisfied: true };

    const providers = this.registry.list();
    const accountGroups = await Promise.all(providers.map(async provider => {
      try {
        return (await provider.listAccounts()).filter(account => account.status === 'ready');
      } catch {
        return [] as StorageAccount[];
      }
    }));

    const accounts = accountGroups.flat();
    const usedAccounts = new Set(verified.map(r => `${r.providerId}:${r.accountId}`));
    const usedProviders = new Set(verified.map(r => r.providerId));
    const reserve = this.policy.reserveBytes ?? 0;

    const candidates = accounts
      .filter(account => account.freeBytes - reserve >= input.sizeBytes)
      .filter(account => !this.policy.distinctAccounts || !usedAccounts.has(accountKey(account)))
      .sort((a, b) => {
        if (this.policy.preferDistinctProviders) {
          const aFresh = usedProviders.has(a.providerId) ? 0 : 1;
          const bFresh = usedProviders.has(b.providerId) ? 0 : 1;
          if (aFresh !== bFresh) return bFresh - aFresh;
        }
        return b.freeBytes - a.freeBytes;
      });

    const replicas = [...input.replicas.filter(r => r.state === 'VERIFIED')];

    for (const account of candidates) {
      if (replicas.filter(r => r.state === 'VERIFIED').length >= this.policy.targetReplicas) break;
      if (this.policy.distinctAccounts && replicas.some(r => r.providerId === account.providerId && r.accountId === account.accountId)) continue;

      const provider = this.registry.get(account.providerId);
      const pending: ReplicaRecord = { providerId: account.providerId, accountId: account.accountId, state: 'UPLOADING' };
      replicas.push(pending);

      try {
        const remote: StorageObject = await provider.upload({
          key: input.key,
          filename: input.filename,
          filePath: input.filePath,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
          accountId: account.accountId,
        });
        Object.assign(pending, {
          state: 'VERIFIED' as const,
          remoteFileId: remote.remoteFileId,
          remotePath: remote.remotePath,
          webViewLink: remote.webViewLink,
          uploadedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
          message: undefined,
        });
        usedAccounts.add(accountKey(account));
        usedProviders.add(account.providerId);
      } catch (error) {
        Object.assign(pending, {
          state: 'ERROR' as const,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const satisfied = replicas.filter(r => r.state === 'VERIFIED').length >= this.policy.targetReplicas;
    if (!satisfied && !replicas.some(r => r.state === 'QUEUED')) {
      replicas.push({ providerId: 'system', state: 'QUEUED', message: `Waiting for storage capacity: ${replicas.filter(r => r.state === 'VERIFIED').length}/${this.policy.targetReplicas} replicas verified.` });
    }

    return { asset: { ...input, replicas }, satisfied };
  }
}
