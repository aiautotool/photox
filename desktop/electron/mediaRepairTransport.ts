import { MediaRepairCoordinator, type RepairMediaResult } from './mediaRepairCoordinator.js';

export type MediaRepairRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MediaRepairPrincipal = {
  subject: string;
  workspaceId: string;
  workspaceRole?: MediaRepairRole;
  deviceId?: string;
  sessionId?: string;
};

export type MediaRepairAuditEvent = {
  action: 'media.repair';
  targetType: 'media';
  targetId: string;
  metadata: {
    status: RepairMediaResult['status'];
    verifiedReplicas: number;
    targetReplicas: number;
    source: 'desktop' | 'web';
  };
};

const ROLE_RANK: Record<MediaRepairRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function assertMediaRepairRole(role: MediaRepairRole | undefined) {
  if (ROLE_RANK[role ?? 'viewer'] < ROLE_RANK.member) {
    throw new Error('MEDIA_REPAIR_FORBIDDEN');
  }
}

/**
 * Shared transport boundary for the exact-media repair coordinator.
 *
 * The workspace always comes from the authenticated principal (Web) or trusted
 * desktop runtime context. Callers never supply a workspace id beside the media
 * key, preventing cross-tenant repair attempts through transport payloads.
 */
export async function repairMediaFromPrincipal(input: {
  principal: MediaRepairPrincipal;
  key: string;
  coordinator: MediaRepairCoordinator;
  source: 'desktop' | 'web';
  appendAudit?: (principal: MediaRepairPrincipal, event: MediaRepairAuditEvent) => Promise<void> | void;
}): Promise<RepairMediaResult> {
  assertMediaRepairRole(input.principal.workspaceRole);
  const key = input.key.trim();
  if (!key) throw new Error('MEDIA_REPAIR_KEY_REQUIRED');

  const result = await input.coordinator.repair(input.principal.workspaceId, key);
  if (input.appendAudit) {
    await input.appendAudit(input.principal, {
      action: 'media.repair',
      targetType: 'media',
      targetId: key,
      metadata: {
        status: result.status,
        verifiedReplicas: result.verifiedReplicas,
        targetReplicas: result.targetReplicas,
        source: input.source,
      },
    });
  }
  return result;
}
