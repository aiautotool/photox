import type { MediaCloudItem, ReplicaRequirement } from './types';

export interface ReplicaPlan {
  assetId: string;
  required: number;
  verified: number;
  missing: number;
  distinctAccounts: number;
  distinctProviders: number;
  healthy: boolean;
  reasons: string[];
}

export class ReplicaPlanner {
  constructor(private readonly defaults: ReplicaRequirement = { targetReplicas: 2, requireDistinctAccounts: true, preferDistinctProviders: true }) {}

  plan(item: MediaCloudItem, requirement: ReplicaRequirement = this.defaults): ReplicaPlan {
    const verified = item.replicas.filter((replica) => replica.state === 'VERIFIED');
    const accountKeys = new Set(verified.map((replica) => `${replica.providerId}:${replica.accountId ?? ''}`));
    const providerIds = new Set(verified.map((replica) => replica.providerId));
    const required = requirement.targetReplicas;
    const reasons: string[] = [];

    if (verified.length < required) reasons.push(`Missing ${required - verified.length} verified replica(s)`);
    if (requirement.requireDistinctAccounts && accountKeys.size < Math.min(required, verified.length || required)) {
      reasons.push('Verified replicas are not distributed across enough distinct accounts');
    }
    if (verified.some((replica) => replica.availability === 'offline' || replica.state === 'ERROR' || replica.state === 'BLOCKED')) {
      reasons.push('One or more replicas are degraded or unavailable');
    }

    return {
      assetId: item.assetId,
      required,
      verified: verified.length,
      missing: Math.max(0, required - verified.length),
      distinctAccounts: accountKeys.size,
      distinctProviders: providerIds.size,
      healthy: reasons.length === 0,
      reasons,
    };
  }
}
