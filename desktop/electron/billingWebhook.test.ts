import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { parseStripeSubscriptionWebhook, verifyStripeWebhookSignature } from './billingWebhook.js';

const secret = 'whsec_test_photox';
const now = 1_800_000_000_000;
const timestamp = Math.floor(now / 1000);

function body(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({
    id: 'evt_123',
    type: 'customer.subscription.updated',
    created: timestamp,
    data: {
      object: {
        id: 'sub_123',
        customer: 'cus_secret',
        status: 'active',
        current_period_start: timestamp - 3600,
        current_period_end: timestamp + 3600,
        cancel_at_period_end: false,
        metadata: {
          photox_workspace_id: 'ws-a',
          photox_plan: 'pro',
        },
      },
    },
    ...overrides,
  }));
}

function signature(raw: Buffer, at = timestamp, key = secret) {
  const digest = crypto.createHmac('sha256', key).update(`${at}.`).update(raw).digest('hex');
  return `t=${at},v1=${digest}`;
}

test('Stripe webhook signature is verified against the exact raw request bytes', () => {
  const raw = body();
  assert.equal(verifyStripeWebhookSignature(raw, signature(raw), secret, now), timestamp);
  assert.throws(() => verifyStripeWebhookSignature(Buffer.concat([raw, Buffer.from(' ')]), signature(raw), secret, now), /BILLING_WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => verifyStripeWebhookSignature(raw, signature(raw, timestamp - 301), secret, now), /BILLING_WEBHOOK_SIGNATURE_EXPIRED/);
});

test('signed subscription webhook maps only strict PhotoX subscription fields', () => {
  const raw = body();
  const state = parseStripeSubscriptionWebhook(raw, signature(raw), secret, now);
  assert.deepEqual(state, {
    workspaceId: 'ws-a',
    provider: 'stripe',
    providerEventId: 'evt_123',
    providerCustomerId: 'cus_secret',
    providerSubscriptionId: 'sub_123',
    plan: 'pro',
    status: 'active',
    currentPeriodStart: (timestamp - 3600) * 1000,
    currentPeriodEnd: (timestamp + 3600) * 1000,
    cancelAtPeriodEnd: false,
    sourceUpdatedAt: timestamp * 1000,
  });
});

test('deleted subscription event is normalized to canceled and cannot promote arbitrary plans', () => {
  const deleted = body({
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_123',
        customer: { id: 'cus_secret' },
        status: 'active',
        current_period_end: timestamp,
        cancel_at_period_end: true,
        metadata: { photox_workspace_id: 'ws-a', photox_plan: 'personal' },
      },
    },
  });
  assert.equal(parseStripeSubscriptionWebhook(deleted, signature(deleted), secret, now).status, 'canceled');

  const invalidPlan = body({
    data: {
      object: {
        id: 'sub_123',
        status: 'active',
        metadata: { photox_workspace_id: 'ws-a', photox_plan: 'enterprise-unbounded' },
      },
    },
  });
  assert.throws(() => parseStripeSubscriptionWebhook(invalidPlan, signature(invalidPlan), secret, now), /BILLING_PLAN_INVALID/);
});

test('unsupported event types and unsigned payloads fail closed before state mutation', () => {
  const unsupported = body({ type: 'invoice.paid' });
  assert.throws(() => parseStripeSubscriptionWebhook(unsupported, signature(unsupported), secret, now), /BILLING_EVENT_UNSUPPORTED/);
  assert.throws(() => parseStripeSubscriptionWebhook(body(), 't=1,v1=deadbeef', secret, now), /BILLING_WEBHOOK_SIGNATURE_INVALID/);
  assert.throws(() => parseStripeSubscriptionWebhook(body(), signature(body()), '', now), /BILLING_WEBHOOK_NOT_CONFIGURED/);
});
