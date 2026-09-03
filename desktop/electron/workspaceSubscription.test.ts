import assert from 'node:assert/strict';
import test from 'node:test';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { WorkspaceSubscriptionService } from './workspaceSubscription.js';

function setup() {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  return { store, workspaces, service: new WorkspaceSubscriptionService(store, workspaces) };
}

test('subscription snapshot falls back to legacy workspace plan before billing is connected', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'personal', now: 100 });
    const snapshot = service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' });
    assert.equal(snapshot.source, 'legacy');
    assert.equal(snapshot.status, 'unmanaged');
    assert.equal(snapshot.plan, 'personal');
    assert.equal(snapshot.cancelAtPeriodEnd, false);
  } finally {
    store.close();
  }
});

test('active provider state is workspace-scoped, monotonic and updates the effective workspace plan', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'personal', now: 100 });
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'owner-b', plan: 'free', now: 100 });

    const first = service.applyProviderState({
      workspaceId: 'ws-a',
      provider: 'test-billing',
      providerCustomerId: 'customer-secret-a',
      providerSubscriptionId: 'sub-a',
      plan: 'pro',
      status: 'active',
      currentPeriodStart: 1_000,
      currentPeriodEnd: 2_000,
      cancelAtPeriodEnd: false,
      sourceUpdatedAt: 1_100,
    }, 1_200);
    assert.equal(first.applied, true);
    assert.equal(workspaces.getWorkspace('ws-a')?.plan, 'pro');
    assert.equal(workspaces.getWorkspace('ws-b')?.plan, 'free');

    const snapshot = service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' });
    assert.equal(snapshot.source, 'billing');
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.plan, 'pro');
    assert.equal(snapshot.currentPeriodEnd, 2_000);
    assert.equal('providerCustomerId' in snapshot, false);

    const stale = service.applyProviderState({
      workspaceId: 'ws-a',
      provider: 'test-billing',
      providerSubscriptionId: 'sub-a',
      plan: 'free',
      status: 'canceled',
      sourceUpdatedAt: 1_000,
    }, 1_300);
    assert.deepEqual(stale, { applied: false, reason: 'STALE_PROVIDER_EVENT' });
    assert.equal(service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' }).status, 'active');

    const audit = workspaces.listAudit('ws-a', 20);
    assert.equal(audit.some(event => event.action === 'subscription.state.updated'), true);
    assert.equal(JSON.stringify(audit).includes('customer-secret-a'), false);
  } finally {
    store.close();
  }
});

test('subscription snapshot enforces active membership, current role and admin access', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a' });
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-b', ownerUserId: 'owner-b' });
    workspaces.putMembership({ workspaceId: 'ws-a', userId: 'admin-a', role: 'admin', status: 'active', joinedAt: 2 });
    workspaces.putMembership({ workspaceId: 'ws-a', userId: 'member-a', role: 'member', status: 'active', joinedAt: 3 });

    assert.equal(service.snapshot({ subject: 'admin-a', workspaceId: 'ws-a', workspaceRole: 'admin' }).workspaceId, 'ws-a');
    assert.throws(() => service.snapshot({ subject: 'member-a', workspaceId: 'ws-a', workspaceRole: 'member' }), /ROLE_FORBIDDEN/);
    assert.throws(() => service.snapshot({ subject: 'owner-b', workspaceId: 'ws-a', workspaceRole: 'owner' }), /MEMBERSHIP_INACTIVE/);
    assert.throws(() => service.snapshot({ subject: 'admin-a', workspaceId: 'ws-a', workspaceRole: 'owner' }), /WORKSPACE_ROLE_STALE/);
  } finally {
    store.close();
  }
});

test('canceled provider state is persisted without silently downgrading the current workspace plan', () => {
  const { store, workspaces, service } = setup();
  try {
    workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'pro' });
    service.applyProviderState({
      workspaceId: 'ws-a',
      provider: 'test-billing',
      providerSubscriptionId: 'sub-a',
      plan: 'pro',
      status: 'canceled',
      currentPeriodEnd: 5_000,
      cancelAtPeriodEnd: true,
      sourceUpdatedAt: 4_000,
    }, 4_100);
    const snapshot = service.snapshot({ subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' });
    assert.equal(snapshot.status, 'canceled');
    assert.equal(snapshot.cancelAtPeriodEnd, true);
    assert.equal(workspaces.getWorkspace('ws-a')?.plan, 'pro');
  } finally {
    store.close();
  }
});
