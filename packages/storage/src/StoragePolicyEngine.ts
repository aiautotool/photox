import type { MediaAsset, StorageAccount, StorageProvider, StorageReplica } from '@photox/contracts';
import { StorageProviderRegistry } from './StorageProviderRegistry';

export interface StoragePolicy {
  minimumReplicas: number;
  requireDifferentAccounts?: boolean;
  preferDifferentProviders?: boolean;
  allowProviders?: string[];
  denyProviders?: string[];
  minimumFreeBytes?: number;
}

export interface StorageCandidate { provider: StorageProvider; account: StorageAccount; score: number; }

export class StoragePolicyEngine {
  constructor(private readonly registry:StorageProviderRegistry, private readonly defaultPolicy:StoragePolicy={minimumReplicas:2,requireDifferentAccounts:true,preferDifferentProviders:true,minimumFreeBytes:100*1024*1024}) {}

  async candidates(asset:MediaAsset, replicas:StorageReplica[]=[], policy:StoragePolicy=this.defaultPolicy):Promise<StorageCandidate[]> {
    const usedAccounts=new Set(replicas.filter(r=>r.state==='VERIFIED').map(r=>`${r.providerId}:${r.accountId}`));
    const usedProviders=new Set(replicas.filter(r=>r.state==='VERIFIED').map(r=>r.providerId));
    const result:StorageCandidate[]=[];
    for(const provider of this.registry.list()) {
      if(policy.allowProviders && !policy.allowProviders.includes(provider.id)) continue;
      if(policy.denyProviders?.includes(provider.id)) continue;
      for(const account of await provider.listAccounts()) {
        if(account.status!=='ready') continue;
        if(policy.requireDifferentAccounts && usedAccounts.has(`${provider.id}:${account.accountId}`)) continue;
        const free=account.freeBytes ?? Number.MAX_SAFE_INTEGER;
        if(free < asset.sizeBytes + (policy.minimumFreeBytes ?? 0)) continue;
        let score=Math.min(free/Math.max(asset.sizeBytes,1),1000);
        if(policy.preferDifferentProviders && !usedProviders.has(provider.id)) score+=10000;
        result.push({provider,account,score});
      }
    }
    return result.sort((a,b)=>b.score-a.score);
  }

  replicasNeeded(replicas:StorageReplica[], policy:StoragePolicy=this.defaultPolicy):number {
    return Math.max(0, policy.minimumReplicas-replicas.filter(r=>r.state==='VERIFIED').length);
  }
}
