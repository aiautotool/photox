import { updateWorkspaceDriveAllocationPolicy } from './driveAccountPolicyStore.js';
import { parseDriveAllocationMutation, type DriveAllocationMutationInput } from './driveAllocationTransport.js';
import type { RendererDriveAccountInfo } from './driveRuntimeAllocation.js';

export type DriveAllocationActor = {
  workspaceId: string;
  userId: string;
  deviceId?: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};

export type DriveAllocationPolicyServiceAuditEvent = {
  workspaceId: string;
  actorUserId: string;
  actorDeviceId?: string;
  action: 'provider.google_drive.allocation_policy.update';
  targetType: 'google_drive';
  targetId: string;
  metadata: {
    maxUsageRatio: number;
    safetyReserveBytes: number;
  };
};

export type DriveAllocationPolicyServiceOptions = {
  directory: string;
  legacyWorkspaceId: string;
  listAccounts: (workspaceId: string) => Promise<RendererDriveAccountInfo[]>;
  appendAudit: (event: DriveAllocationPolicyServiceAuditEvent) => void | Promise<void>;
};

function requireManager(actor: DriveAllocationActor): void {
  if (actor.role !== 'owner' && actor.role !== 'admin') throw new Error('DRIVE_ALLOCATION_ROLE_FORBIDDEN');
  if (!actor.workspaceId) throw new Error('DRIVE_ALLOCATION_WORKSPACE_REQUIRED');
}

export class DriveAllocationPolicyService {
  constructor(private readonly options: DriveAllocationPolicyServiceOptions) {}

  async list(actor: DriveAllocationActor): Promise<RendererDriveAccountInfo[]> {
    if (!actor.workspaceId) throw new Error('DRIVE_ALLOCATION_WORKSPACE_REQUIRED');
    return this.options.listAccounts(actor.workspaceId);
  }

  async update(
    actor: DriveAllocationActor,
    accountId: string,
    body: unknown,
  ): Promise<RendererDriveAccountInfo> {
    requireManager(actor);
    if (!accountId) throw new Error('DRIVE_ALLOCATION_ACCOUNT_ID_REQUIRED');
    const patch: DriveAllocationMutationInput = parseDriveAllocationMutation(body);
    const next = await updateWorkspaceDriveAllocationPolicy({
      directory: this.options.directory,
      workspaceId: actor.workspaceId,
      legacyWorkspaceId: this.options.legacyWorkspaceId,
      accountId,
      patch,
    });

    await this.options.appendAudit({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      actorDeviceId: actor.deviceId,
      action: 'provider.google_drive.allocation_policy.update',
      targetType: 'google_drive',
      targetId: accountId,
      metadata: {
        maxUsageRatio: next.maxUsageRatio,
        safetyReserveBytes: next.safetyReserveBytes,
      },
    });

    const refreshed = await this.options.listAccounts(actor.workspaceId);
    const account = refreshed.find(item => item.id === accountId);
    if (!account) throw new Error('DRIVE_ACCOUNT_NOT_FOUND');
    return account;
  }
}
