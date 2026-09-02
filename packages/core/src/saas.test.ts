import { describe, expect, it } from 'vitest';
import {
  authorizeWorkspaceAction,
  createLegacyPersonalWorkspace,
  DEFAULT_WORKSPACE_PLANS,
  type WorkspaceAccessContext,
} from './saas';

function context(overrides: Partial<WorkspaceAccessContext> = {}): WorkspaceAccessContext {
  const { workspace, membership } = createLegacyPersonalWorkspace({
    workspaceId: 'ws-1',
    ownerUserId: 'user-1',
    plan: 'personal',
    now: 1,
  });
  return {
    workspace,
    membership,
    usage: {
      managedStorageBytes: 0,
      monthlyIngressBytes: 0,
      members: 1,
      devices: 1,
      storageProviders: 1,
      publicShares: 0,
    },
    ...overrides,
  };
}

describe('SaaS workspace authorization', () => {
  it('allows owner media writes inside quota', () => {
    expect(authorizeWorkspaceAction(context(), 'media:write', { storageBytesToAdd: 1024 })).toEqual({ allowed: true });
  });

  it('blocks writes that would exceed storage quota', () => {
    const limit = DEFAULT_WORKSPACE_PLANS.personal.maxManagedStorageBytes!;
    const result = authorizeWorkspaceAction(
      context({ usage: { ...context().usage, managedStorageBytes: limit - 10 } }),
      'media:write',
      { storageBytesToAdd: 11 },
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('QUOTA_EXCEEDED');
    expect(result.quota).toBe('managedStorageBytes');
  });

  it('blocks viewer mutations but permits reads', () => {
    const base = context();
    const viewer = context({ membership: { ...base.membership, role: 'viewer' } });
    expect(authorizeWorkspaceAction(viewer, 'media:read').allowed).toBe(true);
    expect(authorizeWorkspaceAction(viewer, 'media:delete').code).toBe('ROLE_FORBIDDEN');
  });

  it('enforces plan feature flags', () => {
    const base = context();
    const free = context({ workspace: { ...base.workspace, plan: 'free' } });
    expect(authorizeWorkspaceAction(free, 'share:create').code).toBe('FEATURE_DISABLED');
    expect(authorizeWorkspaceAction(free, 'remote:access').code).toBe('FEATURE_DISABLED');
  });

  it('rejects inactive workspaces', () => {
    const base = context();
    const suspended = context({ workspace: { ...base.workspace, status: 'suspended' } });
    expect(authorizeWorkspaceAction(suspended, 'media:read').code).toBe('WORKSPACE_INACTIVE');
  });
});
