import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billingMutationHttpStatus,
  bindBillingMutationRequest,
  parsePublicBillingMutationInput,
} from './billingMutationTransport.js';

const key = 'client-generated-idempotency-key-0001';

test('public billing mutation contract accepts only operation and plan while server binds tenant/provider identity', () => {
  const parsed = parsePublicBillingMutationInput({ operation: 'change_plan', targetPlan: 'pro' }, key);
  assert.deepEqual(parsed.input, { operation: 'change_plan', targetPlan: 'pro' });
  assert.equal(parsed.idempotencyKey, key);

  const request = bindBillingMutationRequest({
    workspaceId: 'workspace-a',
    provider: 'stripe',
    providerSubscriptionId: 'sub_authoritative',
  }, parsed.input, parsed.idempotencyKey);

  assert.deepEqual(request, {
    workspaceId: 'workspace-a',
    provider: 'stripe',
    providerSubscriptionId: 'sub_authoritative',
    operation: 'change_plan',
    targetPlan: 'pro',
    idempotencyKey: key,
  });
});

test('public billing mutation contract rejects client-supplied provider/workspace/subscription binding', () => {
  for (const extra of [
    { workspaceId: 'workspace-b' },
    { provider: 'other' },
    { providerSubscriptionId: 'sub_other' },
    { idempotencyKey: 'body-key-is-forbidden' },
  ]) {
    assert.throws(
      () => parsePublicBillingMutationInput({ operation: 'resume', ...extra }, key),
      /BILLING_MUTATION_BODY_FIELD_FORBIDDEN/,
    );
  }
});

test('public billing mutation contract validates operation, target plan and idempotency header', () => {
  assert.throws(() => parsePublicBillingMutationInput({}, key), /BILLING_MUTATION_OPERATION_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'delete_subscription' }, key), /BILLING_MUTATION_OPERATION_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'change_plan' }, key), /BILLING_TARGET_PLAN_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'change_plan', targetPlan: 'enterprise' }, key), /BILLING_TARGET_PLAN_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'resume', targetPlan: 'pro' }, key), /BILLING_TARGET_PLAN_NOT_ALLOWED/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'resume' }, 'short'), /BILLING_IDEMPOTENCY_KEY_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput({ operation: 'resume' }, 'x'.repeat(201)), /BILLING_IDEMPOTENCY_KEY_INVALID/);
});

test('public billing mutation contract rejects non-plain bodies', () => {
  assert.throws(() => parsePublicBillingMutationInput(null, key), /BILLING_MUTATION_BODY_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput([], key), /BILLING_MUTATION_BODY_INVALID/);
  assert.throws(() => parsePublicBillingMutationInput('resume', key), /BILLING_MUTATION_BODY_INVALID/);
});

test('billing mutation HTTP status mapping is stable for public transport', () => {
  assert.equal(billingMutationHttpStatus(new Error('BILLING_TARGET_PLAN_INVALID')), 400);
  assert.equal(billingMutationHttpStatus(new Error('ROLE_FORBIDDEN')), 403);
  assert.equal(billingMutationHttpStatus(new Error('SUBSCRIPTION_NOT_FOUND')), 404);
  assert.equal(billingMutationHttpStatus(new Error('BILLING_MUTATION_IN_PROGRESS')), 409);
  assert.equal(billingMutationHttpStatus(new Error('BILLING_IDEMPOTENCY_KEY_REUSED')), 409);
  assert.equal(billingMutationHttpStatus(new Error('BILLING_PROVIDER_NOT_CONFIGURED')), 503);
  assert.equal(billingMutationHttpStatus(new Error('STRIPE_REQUEST_FAILED')), 502);
});
