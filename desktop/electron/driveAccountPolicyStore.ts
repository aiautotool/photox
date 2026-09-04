import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES, DEFAULT_PROVIDER_USAGE_RATIO } from '@photosync/core';

export type SavedDriveAccountRecord = {
  id: string;
  workspaceId?: string;
  email?: string;
  tokens: unknown;
  maxUsageRatio?: number;
  safetyReserveBytes?: number;
};

export type DriveAllocationPolicy = {
  maxUsageRatio: number;
  safetyReserveBytes: number;
};

export type DriveAllocationPolicyPatch = Partial<DriveAllocationPolicy>;

function normalizedRatio(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_PROVIDER_USAGE_RATIO;
  return Math.max(0, Math.min(1, value));
}

function normalizedReserve(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_PROVIDER_SAFETY_RESERVE_BYTES;
  return Math.max(0, Math.floor(value));
}

export function driveAllocationPolicyOf(account: SavedDriveAccountRecord): DriveAllocationPolicy {
  return {
    maxUsageRatio: normalizedRatio(account.maxUsageRatio),
    safetyReserveBytes: normalizedReserve(account.safetyReserveBytes),
  };
}

async function writeAccountAtomic(filePath: string, account: SavedDriveAccountRecord): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(account, null, 2), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tempPath, filePath);
}

export async function loadWorkspaceDriveAccounts(
  directory: string,
  workspaceId: string,
  legacyWorkspaceId: string,
): Promise<SavedDriveAccountRecord[]> {
  await fs.mkdir(directory, { recursive: true });
  const files = (await fs.readdir(directory)).filter(name => name.endsWith('.json'));
  const result: SavedDriveAccountRecord[] = [];

  for (const file of files) {
    const filePath = path.join(directory, file);
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as SavedDriveAccountRecord;
      if (!raw?.id || !raw.tokens) continue;
      const account = raw.workspaceId ? raw : { ...raw, workspaceId: legacyWorkspaceId };
      if (!raw.workspaceId) await writeAccountAtomic(filePath, account);
      if (account.workspaceId !== workspaceId) continue;
      result.push(account);
    } catch {
      // A corrupt credential file must not make unrelated accounts unreadable.
    }
  }
  return result;
}

export async function updateWorkspaceDriveAllocationPolicy(input: {
  directory: string;
  workspaceId: string;
  legacyWorkspaceId: string;
  accountId: string;
  patch: DriveAllocationPolicyPatch;
}): Promise<DriveAllocationPolicy> {
  const accounts = await loadWorkspaceDriveAccounts(input.directory, input.workspaceId, input.legacyWorkspaceId);
  const account = accounts.find(item => item.id === input.accountId);
  if (!account) throw new Error('DRIVE_ACCOUNT_NOT_FOUND');

  const current = driveAllocationPolicyOf(account);
  const next: DriveAllocationPolicy = {
    maxUsageRatio: input.patch.maxUsageRatio == null ? current.maxUsageRatio : normalizedRatio(input.patch.maxUsageRatio),
    safetyReserveBytes: input.patch.safetyReserveBytes == null ? current.safetyReserveBytes : normalizedReserve(input.patch.safetyReserveBytes),
  };
  const updated: SavedDriveAccountRecord = {
    ...account,
    workspaceId: input.workspaceId,
    maxUsageRatio: next.maxUsageRatio,
    safetyReserveBytes: next.safetyReserveBytes,
  };
  await writeAccountAtomic(path.join(input.directory, `${account.id}.json`), updated);
  return next;
}
