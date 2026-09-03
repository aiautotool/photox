import assert from 'node:assert/strict';
import test from 'node:test';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { WorkspaceOverviewService } from './workspaceOverview.js';

function setup() {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  return { store, workspaces, service: new WorkspaceOverviewService(workspaces) };
}

test('workspace overview returns tenant-bound plan, usage and quota utilization', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'personal', now: Date.UTC(2026, 8, 1) });
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'owner-b', plan: 'free', now: Date.UTC(2026, 8, 1) });
    workspaces.putMembership({ workspaceId: 'ws-a', userId: 'member-a', role: 'member', status: 'active', joinedAt: 2 });
    workspaces.putMembership({ workspaceId: 'ws-a', userId: 'disabled-a', role: 'viewer', status: 'disabled', joinedAt: 3 });
    workspaces.putDevice({ id: 'desktop-a', workspaceId: 'ws-a', userId: 'owner-a', name: 'A Mac', platform: 'macos', kind: 'desktop', createdAt: 4 });
    workspaces.putDevice({ id: 'phone-a', workspaceId: 'ws-a', userId: 'member-a', name: 'A Phone', platform: 'ios', kind: 'mobile', createdAt: 5 });
    workspaces.putDevice({ id: 'old-a', workspaceId: 'ws-a', userId: 'owner-a', name: 'Old', platform: 'unknown', kind: 'mobile', createdAt: 6, revokedAt: 7 });
    workspaces.setUsage('ws-a', { managedStorageBytes: 25 * 1024 ** 3, monthlyIngressBytes: 10 * 1024 ** 3, members: 99, devices: 99, storageProviders: 3, publicShares: 4 }, Date.UTC(2026, 8, 1));
    workspaces.ensureMonthlyIngressPeriod('ws-a', Date.UTC(2026, 8, 1));

    const snapshot = service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' }, Date.UTC(2026, 8, 2));
    assert.equal(snapshot.workspace.id, 'ws-a');
    assert.equal(snapshot.workspace.plan, 'personal');
    assert.equal(snapshot.membership.role, 'owner');
    assert.equal(snapshot.usage.members, 2);
    assert.equal(snapshot.usage.devices, 2);
    assert.equal(snapshot.usage.storageProviders, 3);
    assert.equal(snapshot.quota.managedStorage.limit, 100 * 1024 ** 3);
    assert.equal(snapshot.quota.managedStorage.percent, 25);
    assert.equal(snapshot.quota.members.current, 2);
    assert.equal(snapshot.quota.members.limit, 1);
    assert.equal(snapshot.entitlements.targetOriginalReplicas, 2);
    assert.equal(workspaces.getUsage('ws-a').members, 2);
    assert.equal(workspaces.getUsage('ws-b').managedStorageBytes, 0);
  } finally {
    store.close();
  }
});

test('workspace overview rejects cross-tenant and stale-role actors', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a' });
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'owner-b' });
    assert.throws(() => service.snapshot({ subject: 'owner-b', workspaceId: 'ws-a', workspaceRole: 'owner' }), /MEMBERSHIP_INACTIVE/);
    assert.throws(() => service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'admin' }), /WORKSPACE_ROLE_STALE/);
  } finally {
    store.close();
  }
});

test('workspace overview applies authoritative UTC monthly ingress rollover', () => {
  const { store, workspaces, service } = setup();
  try {
    const august = Date.UTC(2026, 7, 20);
    const september = Date.UTC(2026, 8, 1);
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', now: august });
    workspaces.ensureMonthlyIngressPeriod('ws-a', august);
    workspaces.setUsage('ws-a', { managedStorageBytes: 500, monthlyIngressBytes: 300, members: 1, devices: 0, storageProviders: 0, publicShares: 0 }, august);
    const snapshot = service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' }, september);
    assert.equal(snapshot.usage.managedStorageBytes, 500);
    assert.equal(snapshot.usage.monthlyIngressBytes, 0);
    assert.equal(snapshot.quota.monthlyIngress.current, 0);
  } finally {
    store.close();
  }
});
