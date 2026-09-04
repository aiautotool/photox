export const GIB = 1024 ** 3;
export const DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES = 100 * 1024 ** 2;
/** @deprecated Use DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES. */
export const RESERVE_BYTES = DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES;
export const DEFAULT_PROVIDER_USAGE_RATIO = 2 / 3;

export type StorageAccount = {
  id: string;
  email: string;
  appUsedBytes: number;
  providerFreeBytes: number;
  providerTotalBytes?: number;
  maxUsageRatio?: number;
  safetyReserveBytes?: number;
  status?: 'READY' | 'NEAR_LIMIT' | 'FULL_FOR_BACKUP' | 'INSUFFICIENT_RESERVE';
};

export type StorageAllocationSnapshot = {
  providerTotalBytes: number | null;
  providerFreeBytes: number;
  providerUsedBytes: number | null;
  allocationRatio: number;
  allocationLimitBytes: number | null;
  safetyReserveBytes: number;
  appUsedBytes: number;
  ratioRemainingBytes: number | null;
  providerRemainingAfterReserveBytes: number;
  availableBytes: number;
};

export type MediaAsset = {
  id: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  localUri?: string;
  remoteFileId?: string;
  accountId?: string;
};

export type MediaType = 'image' | 'video';
export type ReplicaType = 'original' | 'viewable';
export type ReplicaStatus =
  | 'queued'
  | 'uploading'
  | 'processing'
  | 'available'
  | 'missing'
  | 'failed'
  | 'unknown';
export type BackupHealth = 'safe' | 'at_risk' | 'critical' | 'unknown';

export type MediaReplica = {
  providerId: string;
  providerType: 'local' | 'google_drive' | 'youtube' | 'other';
  replicaType: ReplicaType;
  status: ReplicaStatus;
  verifiedAt?: number;
};

export type BackupPolicy = {
  minimumOriginalCopies: number;
  requireRemoteOriginal: boolean;
  requireViewableCopy?: boolean;
};

export type MediaBackupEvaluation = {
  health: BackupHealth;
  originalCopies: number;
  remoteOriginalCopies: number;
  viewableCopies: number;
  missingOriginalCopies: number;
  reasons: string[];
};

export const DEFAULT_PHOTO_POLICY: BackupPolicy = {
  minimumOriginalCopies: 2,
  requireRemoteOriginal: true,
};

export const DEFAULT_VIDEO_POLICY: BackupPolicy = {
  minimumOriginalCopies: 2,
  requireRemoteOriginal: true,
  requireViewableCopy: true,
};

export function evaluateBackupHealth(
  replicas: MediaReplica[],
  policy: BackupPolicy,
): MediaBackupEvaluation {
  const available = replicas.filter(replica => replica.status === 'available');
  const originals = available.filter(replica => replica.replicaType === 'original');
  const remoteOriginals = originals.filter(replica => replica.providerType !== 'local');
  const viewableCopies = available.filter(replica => replica.replicaType === 'viewable').length;
  const unknown = replicas.some(replica => replica.status === 'unknown');
  const missingOriginalCopies = Math.max(0, policy.minimumOriginalCopies - originals.length);
  const reasons: string[] = [];

  if (missingOriginalCopies) reasons.push(`missing_${missingOriginalCopies}_original_copies`);
  if (policy.requireRemoteOriginal && remoteOriginals.length === 0) reasons.push('missing_remote_original');
  if (policy.requireViewableCopy && viewableCopies === 0) reasons.push('missing_viewable_copy');

  const originalPolicyMet = missingOriginalCopies === 0
    && (!policy.requireRemoteOriginal || remoteOriginals.length > 0);

  if (originalPolicyMet && (!policy.requireViewableCopy || viewableCopies > 0)) {
    return { health: 'safe', originalCopies: originals.length, remoteOriginalCopies: remoteOriginals.length, viewableCopies, missingOriginalCopies, reasons: [] };
  }
  if (unknown && originals.length === 0) {
    return { health: 'unknown', originalCopies: 0, remoteOriginalCopies: 0, viewableCopies, missingOriginalCopies, reasons };
  }
  if (originals.length <= 1 || (policy.requireRemoteOriginal && remoteOriginals.length === 0)) {
    return { health: 'critical', originalCopies: originals.length, remoteOriginalCopies: remoteOriginals.length, viewableCopies, missingOriginalCopies, reasons };
  }
  return { health: 'at_risk', originalCopies: originals.length, remoteOriginalCopies: remoteOriginals.length, viewableCopies, missingOriginalCopies, reasons };
}

function normalizedUsageRatio(account: StorageAccount): number {
  const requestedRatio = account.maxUsageRatio ?? DEFAULT_PROVIDER_USAGE_RATIO;
  return Number.isFinite(requestedRatio) ? Math.max(0, Math.min(1, requestedRatio)) : DEFAULT_PROVIDER_USAGE_RATIO;
}

function normalizedSafetyReserve(account: StorageAccount): number {
  const requestedReserve = account.safetyReserveBytes ?? DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES;
  return Number.isFinite(requestedReserve) ? Math.max(0, Math.floor(requestedReserve)) : DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES;
}

export function accountUsageLimit(account: StorageAccount): number {
  const total = account.providerTotalBytes;
  if (!total || !Number.isFinite(total) || total <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(total * normalizedUsageRatio(account));
}

export function storageAllocationSnapshot(account: StorageAccount): StorageAllocationSnapshot {
  const total = account.providerTotalBytes;
  const hasAuthoritativeTotal = Boolean(total && Number.isFinite(total) && total > 0);
  const providerTotalBytes = hasAuthoritativeTotal ? Math.floor(total!) : null;
  const providerFreeBytes = Math.max(0, Math.floor(Number.isFinite(account.providerFreeBytes) ? account.providerFreeBytes : 0));
  const appUsedBytes = Math.max(0, Math.floor(Number.isFinite(account.appUsedBytes) ? account.appUsedBytes : 0));
  const allocationRatio = normalizedUsageRatio(account);
  const safetyReserveBytes = normalizedSafetyReserve(account);
  const allocationLimit = accountUsageLimit(account);
  const allocationLimitBytes = Number.isFinite(allocationLimit) ? allocationLimit : null;
  const ratioRemainingBytes = allocationLimitBytes === null ? null : Math.max(0, allocationLimitBytes - appUsedBytes);
  const providerRemainingAfterReserveBytes = Math.max(0, providerFreeBytes - safetyReserveBytes);
  const availableBytes = Math.max(0, Math.min(ratioRemainingBytes ?? Number.POSITIVE_INFINITY, providerRemainingAfterReserveBytes));
  const providerUsedBytes = providerTotalBytes === null ? null : Math.max(0, providerTotalBytes - providerFreeBytes);
  return {
    providerTotalBytes,
    providerFreeBytes,
    providerUsedBytes,
    allocationRatio,
    allocationLimitBytes,
    safetyReserveBytes,
    appUsedBytes,
    ratioRemainingBytes,
    providerRemainingAfterReserveBytes,
    availableBytes,
  };
}

export function safeAvailable(account: StorageAccount): number {
  return storageAllocationSnapshot(account).availableBytes;
}

export function chooseAccount(accounts: StorageAccount[], fileSize: number): StorageAccount | null {
  return accounts
    .map(account => ({ account, available: safeAvailable(account) }))
    .filter(item => item.available >= fileSize)
    .sort((a, b) => b.available - a.available)[0]?.account ?? null;
}

export function formatGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`;
}

export * from './saas.js';
export * from './tenant.js';


export class OneTimeTicketStore<T> {
  private readonly entries = new Map<string,{value:T;expiresAt:number}>();
  put(token:string,value:T,expiresAt:number){
    if(!token)throw new Error('TICKET_REQUIRED');
    this.entries.set(token,{value,expiresAt});
  }
  consume(token:string,now=Date.now()):T|undefined{
    const entry=this.entries.get(token);
    if(!entry)return undefined;
    this.entries.delete(token);
    if(entry.expiresAt<=now)return undefined;
    return entry.value;
  }
  prune(now=Date.now()){for(const [token,entry] of this.entries)if(entry.expiresAt<=now)this.entries.delete(token);}
  get size(){return this.entries.size;}
}
