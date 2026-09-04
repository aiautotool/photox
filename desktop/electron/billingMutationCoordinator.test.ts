import assert from 'node:assert/strict';
import test from 'node:test';
import { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import { BillingMutationCoordinator, type BillingProviderMutationAdapter } from './billingMutationCoordinator.js';
import { WorkspaceSubscriptionService } from './workspaceSubscription.js';

function setup() {
  const store = new SqlitePhotoXStore({ path: ':memory:' });
  const workspaces = new SqliteWorkspaceRepository(store);
  const subscriptions = new WorkspaceSubscriptionService(store, workspaces);
  const coordinator = new BillingMutationCoordinator(store, workspaces, subscriptions);
  workspaces.ensureLegacyPersonalWorkspace({ workspaceId: 'ws-a', ownerUserId: 'owner-a', plan: 'pro', now: 100 });
  subscriptions.applyProviderState({
    workspaceId: 'ws-a',
    provider: 'stripe',
    providerEventId: 'evt-active',
    providerSubscriptionId: 'sub-a',
    plan: 'pro',
    status: 'active',
    currentPeriodStart: 1_000,
    currentPeriodEnd: 10_000,
    sourceUpdatedAt: 2_000,
  }, 2_100);
  return { store, workspaces, subscriptions, coordinator };
}

const actor = { subject: 'owner-a', workspaceId: 'ws-a', workspaceRole: 'owner' as const, deviceId: 'desktop-a' };

test('billing mutation uses provider idempotency key once and durably replays successful requests', async () => {
  const { store, workspaces, subscriptions, coordinator } = setup();
  let calls = 0;
  const adapter: BillingProviderMutationAdapter = {
    provider: 'stripe',
    async mutate(input) {
      calls += 1;
      assert.equal(input.idempotencyKey, 'idem-cancel-0000000001');
      assert.equal(input.operation, 'cancel_at_period_end');
      return {
        workspaceId: 'ws-a',
        provider: 'stripe',
        providerEventId: 'evt-cancel',
        providerSubscriptionId: 'sub-a',
        plan: 'pro',
        status: 'canceled',
        currentPeriodStart: 1_000,
        currentPeriodEnd: 10_000,
        cancelAtPeriodEnd: true,
        sourceUpdatedAt: 3_000,
      };
    },
  };

  try {
    const input = {
      workspaceId: 'ws-a',
      provider: 'stripe',
      providerSubscriptionId: 'sub-a',
      operation: 'cancel_at_period_end' as const,
      idempotencyKey: 'idem-cancel-0000000001',
    };
    assert.deepEqual(await coordinator.execute(actor, input, adapter, 3_100), {
      status: 'succeeded', replayed: false, attempts: 1, providerStateResult: 'APPLIED',
    });
    assert.equal(calls, 1);
    assert.equal(subscriptions.snapshot(actor).status, 'canceled');
    assert.equal(workspaces.getWorkspace('ws-a')?.plan, 'pro');

    assert.deepEqual(await coordinator.execute(actor, input, adapter, 3_200), {
      status: 'succeeded', replayed: true, attempts: 1, providerStateResult: 'APPLIED',
    });
    assert.equal(calls, 1);

    const row = store.db.prepare(`SELECT idempotency_key_hash,status,attempts,result_code
      FROM photox_subscription_mutations WHERE workspace_id=?`).get('ws-a') as Record<string, unknown>;
    assert.equal(row.status, 'succeeded');
    assert.equal(row.attempts, 1);
    assert.equal(row.result_code, 'APPLIED');
    assert.notEqual(row.idempotency_key_hash, input.idempotencyKey);
    assert.equal(JSON.stringify(row).includes(input.idempotencyKey), false);

    const audit = workspaces.listAudit('ws-a', 20);
    assert.equal(audit.some(event => event.action === 'subscription.mutation.succeeded'), true);
    assert.equal(JSON.stringify(audit).includes(input.idempotencyKey), false);
  } finally {
    store.close();
  }
});

test('idempotency keys cannot be reused for a different billing mutation payload', async () => {
  const { store, coordinator } = setup();
  let calls = 0;
  const adapter: BillingProviderMutationAdapter = {
    provider: 'stripe',
    async mutate() {
      calls += 1;
      return {
        workspaceId: 'ws-a', provider: 'stripe', providerEventId: 'evt-plan', providerSubscriptionId: 'sub-a',
        plan: 'team', status: 'active', sourceUpdatedAt: 3_000,
      };
    },
  };

  try {
    await coordinator.execute(actor, {
      workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a', operation: 'change_plan',
      targetPlan: 'team', idempotencyKey: 'idem-shared-0000000001',
    }, adapter, 3_100);
    await assert.rejects(() => coordinator.execute(actor, {
      workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a', operation: 'resume',
      idempotencyKey: 'idem-shared-0000000001',
    }, adapter, 3_200), /BILLING_IDEMPOTENCY_KEY_REUSED/);
    assert.equal(calls, 1);
  } finally {
    store.close();
  }
});

test('provider state returned by a mutation is scope-bound and failed requests can safely retry with the same key', async () => {
  const { store, coordinator } = setup();
  let badCalls = 0;
  const badAdapter: BillingProviderMutationAdapter = {
    provider: 'stripe',
    async mutate() {
      badCalls += 1;
      return {
        workspaceId: 'ws-other', provider: 'stripe', providerEventId: 'evt-bad', providerSubscriptionId: 'sub-a',
        plan: 'pro', status: 'active', sourceUpdatedAt: 3_000,
      };
    },
  };
  const goodAdapter: BillingProviderMutationAdapter = {
    provider: 'stripe',
    async mutate() {
      return {
        workspaceId: 'ws-a', provider: 'stripe', providerEventId: 'evt-good', providerSubscriptionId: 'sub-a',
        plan: 'pro', status: 'active', sourceUpdatedAt: 3_100,
      };
    },
  };
  const input = {
    workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a', operation: 'resume' as const,
    idempotencyKey: 'idem-retry-0000000001',
  };

  try {
    await assert.rejects(() => coordinator.execute(actor, input, badAdapter, 3_100), /BILLING_PROVIDER_STATE_SCOPE_MISMATCH/);
    assert.equal(badCalls, 1);
    const failed = store.db.prepare(`SELECT status,attempts,last_error_code FROM photox_subscription_mutations
      WHERE workspace_id=?`).get('ws-a') as Record<string, unknown>;
    assert.deepEqual(failed, { status: 'failed', attempts: 1, last_error_code: 'PROVIDER_MUTATION_FAILED' });

    assert.deepEqual(await coordinator.execute(actor, input, goodAdapter, 3_200), {
      status: 'succeeded', replayed: false, attempts: 2, providerStateResult: 'APPLIED',
    });
    const succeeded = store.db.prepare(`SELECT status,attempts,last_error_code FROM photox_subscription_mutations
      WHERE workspace_id=?`).get('ws-a') as Record<string, unknown>;
    assert.deepEqual(succeeded, { status: 'succeeded', attempts: 2, last_error_code: null });
  } finally {
    store.close();
  }
});

test('billing mutation remains tenant/admin scoped before provider invocation', async () => {
  const { store, workspaces, coordinator } = setup();
  workspaces.putMembership({ workspaceId: 'ws-a', userId: 'member-a', role: 'member', status: 'active', joinedAt: 200 });
  let calls = 0;
  const adapter: BillingProviderMutationAdapter = {
    provider: 'stripe',
    async mutate() {
      calls += 1;
      throw new Error('SHOULD_NOT_RUN');
    },
  };

  try {
    await assert.rejects(() => coordinator.execute(
      { subject: 'member-a', workspaceId: 'ws-a', workspaceRole: 'member' },
      {
        workspaceId: 'ws-a', provider: 'stripe', providerSubscriptionId: 'sub-a', operation: 'resume',
        idempotencyKey: 'idem-member-0000000001',
      },
      adapter,
      3_100,
    ), /ROLE_FORBIDDEN/);
    assert.equal(calls, 0);
  } finally {
    store.close();
  }
});
