import type { DriveFile } from '@photosync/google-drive';

export type DriveReplicaHealthState = 'VERIFIED' | 'UPLOADED' | 'ERROR' | 'QUEUED' | 'UPLOADING' | 'VERIFYING' | 'BLOCKED';

export type DriveReplicaHealthRecord = {
  state: DriveReplicaHealthState;
  accountId?: string;
  remoteFileId?: string;
  remoteMd5?: string;
  verifiedAt?: string;
  remoteCheckedAt?: string;
  message?: string;
};

export type DriveReplicaProbeResult =
  | { kind: 'healthy'; checkedAt: string; remoteMd5?: string }
  | { kind: 'missing'; checkedAt: string; message: 'DRIVE_REPLICA_MISSING' }
  | { kind: 'mismatch'; checkedAt: string; message: 'DRIVE_REPLICA_SIZE_MISMATCH' | 'DRIVE_REPLICA_CHECKSUM_MISMATCH' | 'DRIVE_REPLICA_SOURCE_HASH_MISMATCH' | 'DRIVE_REPLICA_ID_MISMATCH' }
  | { kind: 'deferred'; checkedAt: string; message: 'DRIVE_REPLICA_VERIFICATION_DEFERRED' };

function normalizedMd5(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{32}$/.test(normalized) ? normalized : undefined;
}

function normalizedSha256(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function isDefinitiveMissing(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:google drive|drive)\s+(?:404|410)(?::|\b)/i.test(message) || /\b(?:404|410)\b.*\bnot\s+found\b/i.test(message);
}

/**
 * Re-checks the authoritative remote Drive object without uploading bytes.
 * Provider/network/auth failures are treated as deferred so a transient outage
 * does not create duplicate repair uploads. Definitive missing/mismatch results
 * are fail-closed and must no longer count as healthy replicas.
 */
export async function probeDriveReplica(
  input: {
    remoteFileId: string;
    expectedSizeBytes: number;
    storedMd5?: string;
    expectedSha256?: string;
    fetchRemote: (remoteFileId: string) => Promise<DriveFile>;
    now?: () => Date;
  },
): Promise<DriveReplicaProbeResult> {
  const checkedAt = (input.now?.() ?? new Date()).toISOString();
  try {
    const remote = await input.fetchRemote(input.remoteFileId);
    if (!remote?.id || remote.id !== input.remoteFileId) {
      return { kind: 'mismatch', checkedAt, message: 'DRIVE_REPLICA_ID_MISMATCH' };
    }
    const remoteSize = Number(remote.size);
    if (!Number.isSafeInteger(remoteSize) || remoteSize < 0 || remoteSize !== input.expectedSizeBytes) {
      return { kind: 'mismatch', checkedAt, message: 'DRIVE_REPLICA_SIZE_MISMATCH' };
    }
    const expectedSha256 = normalizedSha256(input.expectedSha256);
    const remoteSourceSha256 = normalizedSha256(remote.appProperties?.photosyncSha256);
    if (expectedSha256 && remoteSourceSha256 && expectedSha256 !== remoteSourceSha256) {
      return { kind: 'mismatch', checkedAt, message: 'DRIVE_REPLICA_SOURCE_HASH_MISMATCH' };
    }
    const expectedMd5 = normalizedMd5(input.storedMd5);
    const remoteMd5 = normalizedMd5(remote.md5Checksum);
    if (expectedMd5 && expectedMd5 !== remoteMd5) {
      return { kind: 'mismatch', checkedAt, message: 'DRIVE_REPLICA_CHECKSUM_MISMATCH' };
    }
    return { kind: 'healthy', checkedAt, remoteMd5: remoteMd5 ?? expectedMd5 };
  } catch (error) {
    if (isDefinitiveMissing(error)) return { kind: 'missing', checkedAt, message: 'DRIVE_REPLICA_MISSING' };
    return { kind: 'deferred', checkedAt, message: 'DRIVE_REPLICA_VERIFICATION_DEFERRED' };
  }
}

export function applyDriveReplicaProbe<T extends DriveReplicaHealthRecord>(replica: T, result: DriveReplicaProbeResult): T & DriveReplicaHealthRecord {
  if (result.kind === 'healthy') {
    return {
      ...replica,
      state: 'VERIFIED',
      remoteMd5: result.remoteMd5 ?? replica.remoteMd5,
      verifiedAt: result.checkedAt,
      remoteCheckedAt: result.checkedAt,
      message: undefined,
    };
  }
  if (result.kind === 'deferred') {
    return { ...replica, remoteCheckedAt: result.checkedAt, message: result.message };
  }
  return { ...replica, state: 'ERROR', remoteCheckedAt: result.checkedAt, message: result.message };
}

export function replicaNeedsRemoteVerification(replica: DriveReplicaHealthRecord, nowMs: number, intervalMs: number) {
  if ((replica.state !== 'VERIFIED' && replica.state !== 'UPLOADED') || !replica.accountId || !replica.remoteFileId) return false;
  const checked = replica.remoteCheckedAt ? Date.parse(replica.remoteCheckedAt) : 0;
  return !Number.isFinite(checked) || checked <= 0 || nowMs - checked >= Math.max(0, intervalMs);
}

export function verifiedReplicaAccountCount(replicas: DriveReplicaHealthRecord[]) {
  return new Set(replicas.filter(replica => (replica.state === 'VERIFIED' || replica.state === 'UPLOADED') && replica.accountId).map(replica => replica.accountId)).size;
}
