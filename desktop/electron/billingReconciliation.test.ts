import assert from 'node:assert/strict';
import test from 'node:test';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { BillingReconciliationService } from './billingReconciliation.js';
import type { BillingProviderReadAdapter } from './stripeBillingProvider.js';
import { WorkspaceSubscriptionService } from './workspaceSubscription.js';

function setup() {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  const subscriptions = new WorkspaceSubscriptionService(store, workspaces);
  const reconciliation = new BillingReconciliationService(store, workspaces, subscriptions);
  workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'pro', now: 100 });
  subscriptions.applyProviderState({
    workspaceId: 'ws-a', provider: 'stripe', providerEventId: 'evt-old', providerSubscriptionId: 'sub-a',
    plan: 'pro', status: 'active', currentPeriodStart: 1_000, currentPeriodEnd: 10_000, sourceUpdatedAt: 2_000,
  }, 2_100);
  return { store, workspaces, subscriptions, reconciliation };
}

const actor = { subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' as const, deviceId: 'desktop-a' };

test('billing reconciliation reads authoritative provider state and applies it through subscription invariants', async () => {
  const { store, workspaces, subscriptions, reconciliation } = setup();
  let calls = 0;
  const adapter: BillingProviderReadAdapter = {
    provider: 'stripe',
    async read(id) {
      calls += 1;
      assert.equal(id, 'sub-a');
      return {
        workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a', plan: 'team', status: 'active',
        currentPeriodStart: 1_000, currentPeriodEnd: 20_000, sourceUpdatedAt: 3_000,
      };
    },
  };
  try {
    assert.deepEqual(await reconciliation.reconcile(actor, {
      workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a',
    }, adapter, 3_100), { applied: true });
    assert.equal(calls, 1);
    assert.equal(subscriptions.snapshot(actor).plan, 'team');
    assert.equal(workspaces.getWorkspace('ws-a')?.plan, 'team');
    assert.equal(workspaces.listAudit('ws-a', 20).some(event => event.action === 'subscription.reconciliation.completed'), true);
  } finally {
    store.close();
  }
});

test('billing reconciliation rejects cross-workspace provider state before mutation', async () => {
  const { store, reconciliation } = setup();
  const adapter: BillingProviderReadAdapter = {
    provider: 'stripe',
    async read() {
      return { workspaceId: 'ws-other', provider: 'stripe', providerSubscriptionId: 'sub-a', plan: 'team', status: 'active', sourceUpdatedAt: 3_000 };
    },
  };
  try {
    await assert.rejects(() => reconciliation.reconcile(actor, {
      workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a',
    }, adapter, 3_100), /BILLING_PROVIDER_STATE_SCOPE_MISMATCH/);
  } finally {
    store.close();
  }
});

test('billing reconciliation enforces owner/admin authorization before provider read', async () => {
  const { store, workspaces, reconciliation } = setup();
  workspaces.putMembership({ workspaceId: 'ws-a', userId: 'member-a', role: 'member', status: 'active', joinedAt: 200 });
  let calls = 0;
  const adapter: BillingProviderReadAdapter = {
    provider: 'stripe',
    async read() { calls += 1; throw new Error('SHOULD_NOT_RUN'); },
  };
  try {
    await assert.rejects(() => reconciliation.reconcile(
      { subject: 'member-a', workspaceId: 'ws-a', workspaceRole: 'member' },
      { workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a' },
      adapter,
      3_100,
    ), /ROLE_FORBIDDEN/);
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});
