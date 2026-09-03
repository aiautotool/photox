import type { MediaCloudRepository } from './MediaCloudRepository';
import { MediaCloudCatalog } from './MediaCloudCatalog';
import type { MediaCloudAccountStats, MediaCloudProviderStats, MediaCloudStats } from './types';

export class MediaCloudStatsService {
  constructor(
    private readonly repository: MediaCloudRepository,
    private readonly catalog: MediaCloudCatalog,
    private readonly workspaceId: string,
  ) {
    if (!workspaceId) throw new Error('MEDIA_CLOUD_WORKSPACE_REQUIRED');
  }

  async snapshot(): Promise<MediaCloudStats> {
    const items = await this.repository.list({ workspaceId: this.workspaceId });
    const providers = new Map<string, MediaCloudProviderStats>();
    const accounts = new Map<string, MediaCloudAccountStats>();
    let protectedMediaCount = 0;
    let underReplicatedMediaCount = 0;
    let degradedMediaCount = 0;
    let lostMediaCount = 0;
    let verifiedReplicaCount = 0;
    let totalReplicaCount = 0;
    let totalLogicalBytes = 0;
    let totalReplicaBytes = 0;

    for (const item of items) {
      totalLogicalBytes += item.sizeBytes ?? 0;
      const health = this.catalog.health(item);
      if (health === 'protected') protectedMediaCount++;
      else if (health === 'under_replicated') underReplicatedMediaCount++;
      else if (health === 'degraded') degradedMediaCount++;
      else if (health === 'lost') lostMediaCount++;

      for (const replica of item.replicas) {
        totalReplicaCount++;
        if (replica.state === 'VERIFIED') verifiedReplicaCount++;
        const bytes = replica.sizeBytes ?? item.sizeBytes ?? 0;
        totalReplicaBytes += bytes;
        const provider = providers.get(replica.providerId) ?? {
          providerId: replica.providerId,
          providerDisplayName: replica.providerDisplayName,
          mediaCount: 0,
          verifiedReplicaCount: 0,
          totalReplicaCount: 0,
          totalBytes: 0,
          accountCount: 0,
        };
        provider.totalReplicaCount++;
        if (replica.state === 'VERIFIED') provider.verifiedReplicaCount++;
        provider.totalBytes += bytes;
        providers.set(replica.providerId, provider);

        if (replica.accountId) {
          const key = `${replica.providerId}:${replica.accountId}`;
          const account = accounts.get(key) ?? {
            providerId: replica.providerId,
            accountId: replica.accountId,
            accountDisplayName: replica.accountDisplayName,
            mediaCount: 0,
            verifiedReplicaCount: 0,
            totalReplicaCount: 0,
            totalBytes: 0,
          };
          account.totalReplicaCount++;
          if (replica.state === 'VERIFIED') account.verifiedReplicaCount++;
          account.totalBytes += bytes;
          accounts.set(key, account);
        }
      }
    }

    for (const provider of providers.values()) {
      provider.mediaCount = items.filter((item) => item.replicas.some((r) => r.providerId === provider.providerId)).length;
      provider.accountCount = new Set(items.flatMap((item) => item.replicas.filter((r) => r.providerId === provider.providerId && r.accountId).map((r) => r.accountId as string))).size;
    }
    for (const account of accounts.values()) {
      account.mediaCount = items.filter((item) => item.replicas.some((r) => r.providerId === account.providerId && r.accountId === account.accountId)).length;
    }

    return {
      mediaCount: items.length,
      protectedMediaCount,
      underReplicatedMediaCount,
      degradedMediaCount,
      lostMediaCount,
      verifiedReplicaCount,
      totalReplicaCount,
      totalLogicalBytes,
      totalReplicaBytes,
      providers: [...providers.values()].sort((a, b) => b.mediaCount - a.mediaCount),
      accounts: [...accounts.values()].sort((a, b) => b.mediaCount - a.mediaCount),
    };
  }
}
