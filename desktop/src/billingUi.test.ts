import assert from 'node:assert/strict';
import test from 'node:test';
import { billingMutationFingerprint, billingUiPermissions, createBillingMutationKey } from './billingUi.js';
import type { WorkspaceSubscriptionSnapshot } from './bridge.js';

const baseSubscription: WorkspaceSubscriptionSnapshot = {
  workspaceId: 'workspace-a',
  plan: 'personal',
  source: 'billing',
  status: 'active',
  cancelAtPeriodEnd: false,
  updatedAt: 1,
};

test('billing UI only exposes mutations to owner/admin billing workspaces', () => {
  assert.equal(billingUiPermissions(baseSubscription, 'owner').canManage, true);
  assert.equal(billingUiPermissions(baseSubscription, 'admin').canManage, true);
  assert.equal(billingUiPermissions(baseSubscription, 'member').canManage, false);
  assert.equal(billingUiPermissions(baseSubscription, 'viewer').canManage, false);
  assert.equal(billingUiPermissions({ ...baseSubscription, source: 'legacy', status: 'unmanaged' }, 'owner').canManage, false);
});

test('billing UI action availability follows authoritative lifecycle state', () => {
  const active = billingUiPermissions(baseSubscription, 'owner');
  assert.equal(active.canChangePlan, true);
  assert.equal(active.canCancelAtPeriodEnd, true);
  assert.equal(active.canResume, false);

  const canceling = billingUiPermissions({ ...baseSubscription, cancelAtPeriodEnd: true }, 'owner');
  assert.equal(canceling.canCancelAtPeriodEnd, false);
  assert.equal(canceling.canResume, true);

  const canceled = billingUiPermissions({ ...baseSubscription, status: 'canceled', cancelAtPeriodEnd: true }, 'owner');
  assert.equal(canceled.canChangePlan, false);
  assert.equal(canceled.canCancelAtPeriodEnd, false);
  assert.equal(canceled.canResume, false);
});

test('billing UI idempotency identity is stable for a mutation fingerprint and never embeds provider binding', () => {
  const input = { operation: 'change_plan' as const, targetPlan: 'pro' as const };
  assert.equal(billingMutationFingerprint(input), 'change_plan:pro');
  const key = createBillingMutationKey(input, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(key.length >= 16, true);
  assert.equal(key.includes('workspace-a'), false);
  assert.equal(key.includes('stripe'), false);
  assert.equal(createBillingMutationKey(input, 'same-random'), createBillingMutationKey(input, 'same-random'));
  assert.notEqual(createBillingMutationKey(input, 'random-a'), createBillingMutationKey(input, 'random-b'));
});
