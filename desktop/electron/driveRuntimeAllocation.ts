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
    },
  };
}
