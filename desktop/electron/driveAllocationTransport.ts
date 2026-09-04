import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';

export type DriveAllocationMutationInput = {
  maxUsageRatio?: number;
  safetyReserveBytes?: number;
};

export type DriveAllocationMutation = {
  maxUsageRatio: number;
  safetyReserveBytes: number;
};

function finiteNumber(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`DRIVE_ALLOCATION_${field}_INVALID`);
  return value;
}

export function parseDriveAllocationMutation(body: unknown): DriveAllocationMutationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('DRIVE_ALLOCATION_BODY_INVALID');
  const input = body as Record<string, unknown>;
  const allowed = new Set(['maxUsageRatio', 'safetyReserveBytes']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error('DRIVE_ALLOCATION_FIELD_FORBIDDEN');
  const ratio = finiteNumber(input.maxUsageRatio, 'RATIO');
  const reserve = finiteNumber(input.safetyReserveBytes, 'RESERVE');
  if (ratio == null && reserve == null) throw new Error('DRIVE_ALLOCATION_PATCH_EMPTY');
  if (ratio != null && (ratio < 0 || ratio > 1)) throw new Error('DRIVE_ALLOCATION_RATIO_OUT_OF_RANGE');
  if (reserve != null && reserve < 0) throw new Error('DRIVE_ALLOCATION_RESERVE_OUT_OF_RANGE');
  if (reserve != null && !Number.isSafeInteger(reserve)) throw new Error('DRIVE_ALLOCATION_RESERVE_INVALID');
  return { ...(ratio == null ? {} : { maxUsageRatio: ratio }), ...(reserve == null ? {} : { safetyReserveBytes: reserve }) };
}

export function mergeDriveAllocationPolicy(
  current: Partial<DriveAllocationMutation> | undefined,
  patch: DriveAllocationMutationInput,
): DriveAllocationMutation {
  return {
    maxUsageRatio: patch.maxUsageRatio ?? current?.maxUsageRatio ?? DEFAULT_PROVIDER_USAGE_RATIO,
    safetyReserveBytes: patch.safetyReserveBytes ?? current?.safetyReserveBytes ?? DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES,
  };
}

export function driveAllocationHttpStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'DRIVE_ACCOUNT_NOT_FOUND') return 404;
  if (message.includes('ROLE_FORBIDDEN')) return 403;
  if (message.startsWith('DRIVE_ALLOCATION_')) return 400;
  return 500;
}
