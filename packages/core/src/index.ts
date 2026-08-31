export const GIB = 1024 ** 3;
export const APP_CAP_BYTES = 10 * GIB;
export const RESERVE_BYTES = 100 * 1024 ** 2;

export type StorageAccount = {
  id: string;
  email: string;
  appUsedBytes: number;
  providerFreeBytes: number;
  status?: 'READY' | 'NEAR_LIMIT' | 'FULL_FOR_BACKUP' | 'INSUFFICIENT_RESERVE';
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

export function safeAvailable(account: StorageAccount): number {
  return Math.max(
    0,
    Math.min(
      APP_CAP_BYTES - account.appUsedBytes,
      account.providerFreeBytes - RESERVE_BYTES,
    ),
  );
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
