import { driveAllocationHttpStatus } from './driveAllocationTransport.js';
import { type DriveAllocationActor, DriveAllocationPolicyService } from './driveAllocationPolicyService.js';
import type { RendererDriveAccountInfo } from './driveRuntimeAllocation.js';

export type DriveAllocationWebPrincipal = {
  subject: string;
  workspaceId: string;
  workspaceRole?: 'owner' | 'admin' | 'member' | 'viewer';
  deviceId?: string;
  sessionId?: string;
};

export type DriveAllocationWebResult<T> =
  | { ok: true; status: 200; value: T }
  | { ok: false; status: number; error: string };

export function driveAllocationActorFromWebPrincipal(principal: DriveAllocationWebPrincipal): DriveAllocationActor {
  if (!principal.workspaceId) throw new Error('DRIVE_ALLOCATION_WORKSPACE_REQUIRED');
  return {
    workspaceId: principal.workspaceId,
    userId: principal.subject,
    deviceId: principal.deviceId,
    role: principal.workspaceRole ?? 'viewer',
  };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'DRIVE_ACCOUNT_NOT_FOUND') return message;
  if (message.startsWith('DRIVE_ALLOCATION_')) return message;
  return 'DRIVE_ALLOCATION_INTERNAL_ERROR';
}

export class DriveAllocationWebTransport {
  constructor(private readonly service: DriveAllocationPolicyService) {}

  async list(principal: DriveAllocationWebPrincipal): Promise<DriveAllocationWebResult<RendererDriveAccountInfo[]>> {
    try {
      const value = await this.service.list(driveAllocationActorFromWebPrincipal(principal));
      return { ok: true, status: 200, value };
    } catch (error) {
      return { ok: false, status: driveAllocationHttpStatus(error), error: safeError(error) };
    }
  }

  async update(
    principal: DriveAllocationWebPrincipal,
    accountId: string,
    body: unknown,
  ): Promise<DriveAllocationWebResult<RendererDriveAccountInfo>> {
    try {
      const value = await this.service.update(driveAllocationActorFromWebPrincipal(principal), accountId, body);
      return { ok: true, status: 200, value };
    } catch (error) {
      return { ok: false, status: driveAllocationHttpStatus(error), error: safeError(error) };
    }
  }
}
