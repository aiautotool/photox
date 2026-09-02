export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspacePlanCode = 'free' | 'personal' | 'pro' | 'family' | 'team';

export type WorkspaceAction =
  | 'media:read'
  | 'media:write'
  | 'media:delete'
  | 'album:manage'
  | 'share:create'
  | 'provider:manage'
  | 'member:manage'
  | 'workspace:manage'
  | 'device:register'
  | 'remote:access';

export interface Workspace {
  id: string;
  name: string;
  ownerUserId: string;
  plan: WorkspacePlanCode;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'suspended' | 'pending_deletion';
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: number;
  status: 'active' | 'invited' | 'disabled';
}

export interface WorkspaceDevice {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  platform: 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'web' | 'unknown';
  kind: 'mobile' | 'desktop' | 'server' | 'web';
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
}

export interface WorkspaceUsage {
  managedStorageBytes: number;
  monthlyIngressBytes: number;
  members: number;
  devices: number;
  storageProviders: number;
  publicShares: number;
}

export interface WorkspaceEntitlements {
  maxManagedStorageBytes: number | null;
  maxMonthlyIngressBytes: number | null;
  maxMembers: number | null;
  maxDevices: number | null;
  maxStorageProviders: number | null;
  maxPublicShares: number | null;
  targetOriginalReplicas: number;
  publicSharing: boolean;
  remoteAccess: boolean;
  semanticSearch: boolean;
  priorityVideoProcessing: boolean;
}

export type PlanCatalog = Record<WorkspacePlanCode, WorkspaceEntitlements>;

/** Technical migration defaults for v4. These are product configuration, not billing prices. */
export const DEFAULT_WORKSPACE_PLANS: PlanCatalog = {
  free: {
    maxManagedStorageBytes: 5 * 1024 ** 3,
    maxMonthlyIngressBytes: 5 * 1024 ** 3,
    maxMembers: 1,
    maxDevices: 2,
    maxStorageProviders: 2,
    maxPublicShares: 0,
    targetOriginalReplicas: 1,
    publicSharing: false,
    remoteAccess: false,
    semanticSearch: false,
    priorityVideoProcessing: false,
  },
  personal: {
    maxManagedStorageBytes: 100 * 1024 ** 3,
    maxMonthlyIngressBytes: 100 * 1024 ** 3,
    maxMembers: 1,
    maxDevices: 5,
    maxStorageProviders: 6,
    maxPublicShares: 20,
    targetOriginalReplicas: 2,
    publicSharing: true,
    remoteAccess: true,
    semanticSearch: false,
    priorityVideoProcessing: false,
  },
  pro: {
    maxManagedStorageBytes: 1024 * 1024 ** 3,
    maxMonthlyIngressBytes: 1024 * 1024 ** 3,
    maxMembers: 1,
    maxDevices: 10,
    maxStorageProviders: 12,
    maxPublicShares: 200,
    targetOriginalReplicas: 2,
    publicSharing: true,
    remoteAccess: true,
    semanticSearch: true,
    priorityVideoProcessing: true,
  },
  family: {
    maxManagedStorageBytes: 2 * 1024 ** 4,
    maxMonthlyIngressBytes: 2 * 1024 ** 4,
    maxMembers: 6,
    maxDevices: 30,
    maxStorageProviders: 20,
    maxPublicShares: 500,
    targetOriginalReplicas: 2,
    publicSharing: true,
    remoteAccess: true,
    semanticSearch: true,
    priorityVideoProcessing: true,
  },
  team: {
    maxManagedStorageBytes: null,
    maxMonthlyIngressBytes: null,
    maxMembers: null,
    maxDevices: null,
    maxStorageProviders: null,
    maxPublicShares: null,
    targetOriginalReplicas: 2,
    publicSharing: true,
    remoteAccess: true,
    semanticSearch: true,
    priorityVideoProcessing: true,
  },
};

export interface WorkspaceAccessContext {
  workspace: Workspace;
  membership: WorkspaceMembership;
  usage: WorkspaceUsage;
  entitlements?: WorkspaceEntitlements;
}

export interface WorkspaceAccessDecision {
  allowed: boolean;
  code?: 'WORKSPACE_INACTIVE' | 'MEMBERSHIP_INACTIVE' | 'ROLE_FORBIDDEN' | 'FEATURE_DISABLED' | 'QUOTA_EXCEEDED';
  message?: string;
  quota?: keyof WorkspaceUsage;
  current?: number;
  limit?: number;
}

const ROLE_ACTIONS: Record<WorkspaceRole, ReadonlySet<WorkspaceAction>> = {
  owner: new Set<WorkspaceAction>(['media:read','media:write','media:delete','album:manage','share:create','provider:manage','member:manage','workspace:manage','device:register','remote:access']),
  admin: new Set<WorkspaceAction>(['media:read','media:write','media:delete','album:manage','share:create','provider:manage','member:manage','device:register','remote:access']),
  member: new Set<WorkspaceAction>(['media:read','media:write','media:delete','album:manage','share:create','device:register','remote:access']),
  viewer: new Set<WorkspaceAction>(['media:read','remote:access']),
};

function quotaDecision(quota: keyof WorkspaceUsage, current: number, limit: number | null, increment: number): WorkspaceAccessDecision | undefined {
  if (limit === null || current + increment <= limit) return undefined;
  return { allowed: false, code: 'QUOTA_EXCEEDED', message: `${quota} quota exceeded`, quota, current, limit };
}

export function entitlementsForPlan(plan: WorkspacePlanCode, catalog: PlanCatalog = DEFAULT_WORKSPACE_PLANS): WorkspaceEntitlements {
  return catalog[plan];
}

export function authorizeWorkspaceAction(
  context: WorkspaceAccessContext,
  action: WorkspaceAction,
  options: { storageBytesToAdd?: number; ingressBytesToAdd?: number } = {},
): WorkspaceAccessDecision {
  if (context.workspace.status !== 'active') return { allowed: false, code: 'WORKSPACE_INACTIVE', message: 'Workspace is not active' };
  if (context.membership.status !== 'active' || context.membership.workspaceId !== context.workspace.id) {
    return { allowed: false, code: 'MEMBERSHIP_INACTIVE', message: 'Membership is not active for this workspace' };
  }
  if (!ROLE_ACTIONS[context.membership.role].has(action)) {
    return { allowed: false, code: 'ROLE_FORBIDDEN', message: `${context.membership.role} cannot perform ${action}` };
  }

  const plan = context.entitlements ?? entitlementsForPlan(context.workspace.plan);
  if (action === 'share:create' && !plan.publicSharing) return { allowed: false, code: 'FEATURE_DISABLED', message: 'Public sharing is disabled for this plan' };
  if (action === 'remote:access' && !plan.remoteAccess) return { allowed: false, code: 'FEATURE_DISABLED', message: 'Remote access is disabled for this plan' };

  if (action === 'media:write') {
    const storage = quotaDecision('managedStorageBytes', context.usage.managedStorageBytes, plan.maxManagedStorageBytes, options.storageBytesToAdd ?? 0);
    if (storage) return storage;
    const ingress = quotaDecision('monthlyIngressBytes', context.usage.monthlyIngressBytes, plan.maxMonthlyIngressBytes, options.ingressBytesToAdd ?? options.storageBytesToAdd ?? 0);
    if (ingress) return ingress;
  }
  if (action === 'member:manage') {
    const members = quotaDecision('members', context.usage.members, plan.maxMembers, 1);
    if (members) return members;
  }
  if (action === 'device:register') {
    const devices = quotaDecision('devices', context.usage.devices, plan.maxDevices, 1);
    if (devices) return devices;
  }
  if (action === 'provider:manage') {
    const providers = quotaDecision('storageProviders', context.usage.storageProviders, plan.maxStorageProviders, 1);
    if (providers) return providers;
  }
  if (action === 'share:create') {
    const shares = quotaDecision('publicShares', context.usage.publicShares, plan.maxPublicShares, 1);
    if (shares) return shares;
  }
  return { allowed: true };
}

export function usagePercent(current: number, limit: number | null): number | null {
  if (limit === null) return null;
  if (limit <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / limit) * 100)));
}

export function createLegacyPersonalWorkspace(input: { workspaceId: string; ownerUserId: string; name?: string; plan?: WorkspacePlanCode; now?: number }): { workspace: Workspace; membership: WorkspaceMembership } {
  const now = input.now ?? Date.now();
  return {
    workspace: { id: input.workspaceId, name: input.name ?? 'My PhotoX', ownerUserId: input.ownerUserId, plan: input.plan ?? 'personal', createdAt: now, updatedAt: now, status: 'active' },
    membership: { workspaceId: input.workspaceId, userId: input.ownerUserId, role: 'owner', joinedAt: now, status: 'active' },
  };
}
