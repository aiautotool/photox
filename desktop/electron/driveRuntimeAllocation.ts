import { storageAllocationSnapshot, type StorageAccount, type StorageAllocationSnapshot } from '@photosync/core';
import { driveAllocationPolicyOf, type SavedDriveAccountRecord } from './driveAccountPolicyStore.js';

export type DriveQuotaInput = {
  limit: number;
  usage: number;
};

export type DriveRuntimeAllocation = {
  storage: StorageAccount;
  snapshot: StorageAllocationSnapshot;
};

export type RendererDriveAllocationVerification = {
  source: 'google-drive-about.storageQuota';
  status: 'verified' | 'unavailable';
  blockers: string[];
  expectedAllocationLimitBytes: number | null;
  expectedProviderRemainingAfterReserveBytes: number;
  expectedAvailableBytes: number;
};

export type RendererDriveAllocationSnapshot = {
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
  verification: RendererDriveAllocationVerification;
};

export type RendererDriveAccountInfo = {
  id: string;
  email: string;
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
  status: 'ready' | 'unavailable';
  allocation: RendererDriveAllocationSnapshot;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function rendererVerification(snapshot: StorageAllocationSnapshot): RendererDriveAllocationVerification {
  if (snapshot.providerTotalBytes === null || snapshot.allocationLimitBytes === null || snapshot.ratioRemainingBytes === null) {
    return {
      source: 'google-drive-about.storageQuota',
      status: 'unavailable',
      blockers: ['AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE'],
      expectedAllocationLimitBytes: null,
      expectedProviderRemainingAfterReserveBytes: Math.max(0, snapshot.providerFreeBytes - snapshot.safetyReserveBytes),
      expectedAvailableBytes: 0,
    };
  }

  const expectedAllocationLimitBytes = Math.floor(snapshot.providerTotalBytes * snapshot.allocationRatio);
  const expectedRatioRemainingBytes = Math.max(0, expectedAllocationLimitBytes - snapshot.appUsedBytes);
  const expectedProviderRemainingAfterReserveBytes = Math.max(0, snapshot.providerFreeBytes - snapshot.safetyReserveBytes);
  const expectedAvailableBytes = Math.max(0, Math.min(expectedRatioRemainingBytes, expectedProviderRemainingAfterReserveBytes));
  const blockers: string[] = [];
  if (snapshot.allocationLimitBytes !== expectedAllocationLimitBytes) blockers.push('ALLOCATION_RATIO_MISMATCH');
  if (snapshot.ratioRemainingBytes !== expectedRatioRemainingBytes) blockers.push('ALLOCATION_REMAINING_MISMATCH');
  if (snapshot.providerRemainingAfterReserveBytes !== expectedProviderRemainingAfterReserveBytes) blockers.push('PROVIDER_REMAINING_MISMATCH');
  if (snapshot.availableBytes !== expectedAvailableBytes) blockers.push('EFFECTIVE_AVAILABLE_MISMATCH');

  return {
    source: 'google-drive-about.storageQuota',
    status: blockers.length ? 'unavailable' : 'verified',
    blockers,
    expectedAllocationLimitBytes,
    expectedProviderRemainingAfterReserveBytes,
    expectedAvailableBytes,
  };
}

export function driveRuntimeAllocation(input: {
  account: SavedDriveAccountRecord;
  email: string;
  quota: DriveQuotaInput;
  appUsedBytes: number;
}): DriveRuntimeAllocation {
  const policy = driveAllocationPolicyOf(input.account);
  const total = finiteNonNegative(input.quota.limit);
  const usage = finiteNonNegative(input.quota.usage);
  const providerFreeBytes = Math.max(0, total - usage);

  const storage: StorageAccount = {
    id: input.account.id,
    email: input.email,
    appUsedBytes: finiteNonNegative(input.appUsedBytes),
    providerFreeBytes,
    providerTotalBytes: total,
    maxUsageRatio: policy.maxUsageRatio,
    safetyReserveBytes: policy.safetyReserveBytes,
  };

  return { storage, snapshot: storageAllocationSnapshot(storage) };
}

export function rendererDriveAllocationSnapshot(snapshot: StorageAllocationSnapshot): RendererDriveAllocationSnapshot {
  return {
    providerTotalBytes: snapshot.providerTotalBytes,
    providerFreeBytes: snapshot.providerFreeBytes,
    providerUsedBytes: snapshot.providerUsedBytes,
    allocationRatio: snapshot.allocationRatio,
    allocationLimitBytes: snapshot.allocationLimitBytes,
    safetyReserveBytes: snapshot.safetyReserveBytes,
    appUsedBytes: snapshot.appUsedBytes,
    ratioRemainingBytes: snapshot.ratioRemainingBytes,
    providerRemainingAfterReserveBytes: snapshot.providerRemainingAfterReserveBytes,
    availableBytes: snapshot.availableBytes,
    verification: rendererVerification(snapshot),
  };
}

export function rendererDriveAccountInfo(input: {
  account: SavedDriveAccountRecord;
  email?: string;
  runtime?: DriveRuntimeAllocation;
}): RendererDriveAccountInfo {
  const email = input.email || input.account.email || input.account.id;
  if (input.runtime) {
    const snapshot = input.runtime.snapshot;
    return {
      id: input.account.id,
      email,
      usedBytes: snapshot.providerUsedBytes ?? 0,
      freeBytes: snapshot.providerFreeBytes,
      totalBytes: snapshot.providerTotalBytes ?? 0,
      status: 'ready',
      allocation: rendererDriveAllocationSnapshot(snapshot),
    };
  }

  const policy = driveAllocationPolicyOf(input.account);
  return {
    id: input.account.id,
    email,
    usedBytes: 0,
    freeBytes: 0,
    totalBytes: 0,
    status: 'unavailable',
    allocation: {
      providerTotalBytes: null,
      providerFreeBytes: 0,
      providerUsedBytes: null,
      allocationRatio: policy.maxUsageRatio,
      allocationLimitBytes: null,
      safetyReserveBytes: policy.safetyReserveBytes,
      appUsedBytes: 0,
      ratioRemainingBytes: null,
      providerRemainingAfterReserveBytes: 0,
      availableBytes: 0,
      verification: {
        source: 'google-drive-about.storageQuota',
        status: 'unavailable',
        blockers: ['AUTHORITATIVE_GOOGLE_DRIVE_QUOTA_UNAVAILABLE'],
        expectedAllocationLimitBytes: null,
        expectedProviderRemainingAfterReserveBytes: 0,
        expectedAvailableBytes: 0,
      },
    },
  };
}
