import {
  entitlementsForPlan,
  usagePercent,
  type WorkspaceEntitlements,
  type WorkspaceMembership,
  type WorkspaceRole,
  type WorkspaceUsage,
} from '@photosync/core';
import type { SqliteWorkspaceRepository } from '@photox/persistence-sqlite';

export type WorkspaceOverviewActor = {
  subject: string;
  workspaceId: string;
  workspaceRole?: WorkspaceRole;
};

export type WorkspaceQuotaDimension = {
  current: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
};

export type WorkspaceOverviewSnapshot = {
  workspace: {
    id: string;
    name: string;
    ownerUserId: string;
    plan: string;
    status: string;
  };
  membership: Pick<WorkspaceMembership, 'userId' | 'role' | 'status' | 'joinedAt'>;
  usage: WorkspaceUsage;
  entitlements: WorkspaceEntitlements;
  quota: {
    managedStorage: WorkspaceQuotaDimension;
    monthlyIngress: WorkspaceQuotaDimension;
    members: WorkspaceQuotaDimension;
    devices: WorkspaceQuotaDimension;
    storageProviders: WorkspaceQuotaDimension;
    publicShares: WorkspaceQuotaDimension;
  };
};

function quota(current: number, limit: number | null): WorkspaceQuotaDimension {
  return {
    current,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - current),
    percent: usagePercent(current, limit),
  };
}

export class WorkspaceOverviewService {
  constructor(private readonly workspaces: SqliteWorkspaceRepository) {}

  snapshot(actor: WorkspaceOverviewActor, now = Date.now()): WorkspaceOverviewSnapshot {
    const workspace = this.workspaces.getWorkspace(actor.workspaceId);
    if (!workspace || workspace.status !== 'active') throw new Error('WORKSPACE_INACTIVE');

    const membership = this.workspaces.getMembership(actor.workspaceId, actor.subject);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    if (actor.workspaceRole && actor.workspaceRole !== membership.role) throw new Error('WORKSPACE_ROLE_STALE');

    const periodUsage = this.workspaces.ensureMonthlyIngressPeriod(actor.workspaceId, now);
    const activeMembers = this.workspaces.listMemberships(actor.workspaceId).filter(item => item.status === 'active').length;
    const activeDevices = this.workspaces.listDevices(actor.workspaceId).filter(item => !item.revokedAt).length;
    const usage: WorkspaceUsage = {
      ...periodUsage,
      members: activeMembers,
      devices: activeDevices,
    };
    if (usage.members !== periodUsage.members || usage.devices !== periodUsage.devices) {
      this.workspaces.setUsage(actor.workspaceId, usage, now);
    }

    const entitlements = entitlementsForPlan(workspace.plan);
    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        ownerUserId: workspace.ownerUserId,
        plan: workspace.plan,
        status: workspace.status,
      },
      membership: {
        userId: membership.userId,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joinedAt,
      },
      usage,
      entitlements,
      quota: {
        managedStorage: quota(usage.managedStorageBytes, entitlements.maxManagedStorageBytes),
        monthlyIngress: quota(usage.monthlyIngressBytes, entitlements.maxMonthlyIngressBytes),
        members: quota(usage.members, entitlements.maxMembers),
        devices: quota(usage.devices, entitlements.maxDevices),
        storageProviders: quota(usage.storageProviders, entitlements.maxStorageProviders),
        publicShares: quota(usage.publicShares, entitlements.maxPublicShares),
      },
    };
  }
}
