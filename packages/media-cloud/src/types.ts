import type { StorageReplica } from '@photox/contracts';

export type MediaCloudHealth = 'protected' | 'under_replicated' | 'degraded' | 'lost' | 'unknown';
export type ReplicaAvailability = 'online' | 'offline' | 'unknown';

export interface MediaCloudReplica extends StorageReplica {
  replicaId: string;
  assetId: string;
  accountDisplayName?: string;
  providerDisplayName?: string;
  availability?: ReplicaAvailability;
  lastCheckedAt?: string;
  lastErrorAt?: string;
}

export interface MediaCloudItem {
  assetId: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  createdAt?: string;
  updatedAt: string;
  targetReplicas: number;
  replicas: MediaCloudReplica[];
  metadata?: Record<string, unknown>;
}

export interface MediaCloudItemSummary {
  assetId: string;
  filename: string;
  targetReplicas: number;
  verifiedReplicas: number;
  providerCount: number;
  accountCount: number;
  health: MediaCloudHealth;
  locations: Array<{
    providerId: string;
    accountId?: string;
    providerDisplayName?: string;
    accountDisplayName?: string;
    state: MediaCloudReplica['state'];
    remoteFileId?: string;
    webViewLink?: string;
  }>;
}

export interface MediaCloudProviderStats {
  providerId: string;
  providerDisplayName?: string;
  mediaCount: number;
  verifiedReplicaCount: number;
  totalReplicaCount: number;
  totalBytes: number;
  accountCount: number;
}

export interface MediaCloudAccountStats {
  providerId: string;
  accountId: string;
  accountDisplayName?: string;
  mediaCount: number;
  verifiedReplicaCount: number;
  totalReplicaCount: number;
  totalBytes: number;
}

export interface MediaCloudStats {
  mediaCount: number;
  protectedMediaCount: number;
  underReplicatedMediaCount: number;
  degradedMediaCount: number;
  lostMediaCount: number;
  verifiedReplicaCount: number;
  totalReplicaCount: number;
  totalLogicalBytes: number;
  totalReplicaBytes: number;
  providers: MediaCloudProviderStats[];
  accounts: MediaCloudAccountStats[];
}

export interface MediaCloudQuery {
  providerId?: string;
  accountId?: string;
  health?: MediaCloudHealth;
  text?: string;
  limit?: number;
  offset?: number;
}

export interface ReplicaRequirement {
  targetReplicas: number;
  requireDistinctAccounts?: boolean;
  preferDistinctProviders?: boolean;
}
