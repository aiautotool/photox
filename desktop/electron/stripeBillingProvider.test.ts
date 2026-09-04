import assert from 'node:assert/strict';
import test from 'node:test';
import { StripeBillingProviderAdapter, parseStripeSubscriptionState, stripeBillingConfigFromEnv } from './stripeBillingProvider.js';

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_a',
    customer: 'cus_a',
    status: 'active',
    metadata: { photox_workspace_id: 'ws-a', photox_plan: 'pro' },
    current_period_start: 10,
    current_period_end: 20,
    cancel_at_period_end: false,
    items: { data: [{ id: 'si_a', price: { id: 'price_pro' } }] },
    ...overrides,
  };
}

test('Stripe adapter changes plan with provider idempotency and returns authoritative state', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(subscription()), { status: 200 });
    return new Response(JSON.stringify(subscription({
      metadata: { photox_workspace_id: 'ws-a', photox_plan: 'team' },
      items: { data: [{ id: 'si_a', price: { id: 'price_team' } }] },
    })), { status: 200 });
  };
  const adapter = new StripeBillingProviderAdapter({
    secretKey: 'sk_test_secret',
    priceByPlan: { team: 'price_team' },
    apiBaseUrl: 'https://stripe.test',
  }, mockFetch, () => 30_000);

  const state = await adapter.mutate({
    providerSubscriptionId: 'sub_a', operation: 'change_plan', targetPlan: 'team', idempotencyKey: 'idem-1234567890123456',
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, 'https://stripe.test/v1/subscriptions/sub_a');
  assert.equal(calls[1]?.init?.headers && (calls[1].init?.headers as Record<string, string>)['Idempotency-Key'], 'idem-1234567890123456');
  const body = new URLSearchParams(String(calls[1]?.init?.body));
  assert.equal(body.get('items[0][id]'), 'si_a');
  assert.equal(body.get('items[0][price]'), 'price_team');
  assert.equal(body.get('metadata[photox_plan]'), 'team');
  assert.equal(body.get('cancel_at_period_end'), 'false');
  assert.equal(state.workspaceId, 'ws-a');
  assert.equal(state.plan, 'team');
  assert.equal(state.sourceUpdatedAt, 30_000);
});

test('Stripe adapter cancel/resume only changes period-end cancellation state', async () => {
  const bodies: string[] = [];
  const mockFetch: typeof fetch = async (_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(subscription()), { status: 200 });
    bodies.push(String(init?.body));
    return new Response(JSON.stringify(subscription({ cancel_at_period_end: bodies.length === 1 })), { status: 200 });
  };
  const adapter = new StripeBillingProviderAdapter({ secretKey: 'sk_test', priceByPlan: {} }, mockFetch, () => 50_000);
  await adapter.mutate({ providerSubscriptionId: 'sub_a', operation: 'cancel_at_period_end', idempotencyKey: 'idem-cancel-0000000001' });
  await adapter.mutate({ providerSubscriptionId: 'sub_a', operation: 'resume', idempotencyKey: 'idem-resume-0000000001' });
  assert.equal(new URLSearchParams(bodies[0]).get('cancel_at_period_end'), 'true');
  assert.equal(new URLSearchParams(bodies[1]).get('cancel_at_period_end'), 'false');
});

test('Stripe adapter fails closed for unconfigured prices and provider errors', async () => {
  const okFetch: typeof fetch = async () => new Response(JSON.stringify(subscription()), { status: 200 });
  const adapter = new StripeBillingProviderAdapter({ secretKey: 'sk_test', priceByPlan: {} }, okFetch);
  await assert.rejects(() => adapter.mutate({
    providerSubscriptionId: 'sub_a', operation: 'change_plan', targetPlan: 'team', idempotencyKey: 'idem-price-0000000001',
  }), /BILLING_STRIPE_PRICE_NOT_CONFIGURED/);

  const badFetch: typeof fetch = async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error' } }), { status: 400 });
  const badAdapter = new StripeBillingProviderAdapter({ secretKey: 'sk_test', priceByPlan: {} }, badFetch);
  await assert.rejects(() => badAdapter.read('sub_a'), /BILLING_STRIPE_REQUEST_FAILED:invalid_request_error/);
});

test('Stripe subscription parsing and env mapping are strict', () => {
  assert.equal(parseStripeSubscriptionState(subscription(), 99).providerCustomerId, 'cus_a');
  assert.throws(() => parseStripeSubscriptionState(subscription({ metadata: { photox_workspace_id: 'ws-a', photox_plan: 'enterprise' } })), /BILLING_PLAN_INVALID/);
  const config = stripeBillingConfigFromEnv({
    PHOTOX_STRIPE_SECRET_KEY: ' sk_live_x ',
    PHOTOX_STRIPE_PRICE_PRO: ' price_pro ',
  });
  assert.equal(config.secretKey, 'sk_live_x');
  assert.equal(config.priceByPlan.pro, 'price_pro');
});
