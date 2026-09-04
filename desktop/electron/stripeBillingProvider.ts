import type { WorkspacePlanCode } from '@photosync/core';
import type {
  BillingMutationOperation,
  BillingProviderMutationAdapter,
  BillingProviderMutationInput,
} from './billingMutationCoordinator.js';
import type { ProviderSubscriptionState, WorkspaceSubscriptionStatus } from './workspaceSubscription.js';

const ALLOWED_PLANS = new Set<WorkspacePlanCode>(['free', 'personal', 'pro', 'family', 'team']);
const STATUS_MAP: Record<string, WorkspaceSubscriptionStatus | undefined> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
  incomplete: 'incomplete',
  unpaid: 'past_due',
};

export type StripeBillingProviderConfig = {
  secretKey: string;
  priceByPlan: Partial<Record<WorkspacePlanCode, string>>;
  apiBaseUrl?: string;
  timeoutMs?: number;
};

export type BillingProviderReadAdapter = {
  readonly provider: string;
  read(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
};

type FetchLike = typeof fetch;

type StripeSubscription = Record<string, unknown>;

function requiredString(value: unknown, code: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function epochMs(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value * 1000) : undefined;
}

function firstSubscriptionItem(subscription: StripeSubscription) {
  const items = subscription.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('BILLING_STRIPE_ITEMS_REQUIRED');
  const data = (items as Record<string, unknown>).data;
  if (!Array.isArray(data) || !data.length || !data[0] || typeof data[0] !== 'object') {
    throw new Error('BILLING_STRIPE_ITEM_REQUIRED');
  }
  return data[0] as Record<string, unknown>;
}

export function parseStripeSubscriptionState(subscription: StripeSubscription, observedAt = Date.now()): ProviderSubscriptionState {
  const providerSubscriptionId = requiredString(subscription.id, 'BILLING_SUBSCRIPTION_ID_REQUIRED');
  const metadata = subscription.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('BILLING_METADATA_REQUIRED');
  const meta = metadata as Record<string, unknown>;
  const workspaceId = requiredString(meta.photox_workspace_id, 'BILLING_WORKSPACE_ID_REQUIRED');
  const plan = requiredString(meta.photox_plan, 'BILLING_PLAN_REQUIRED') as WorkspacePlanCode;
  if (!ALLOWED_PLANS.has(plan)) throw new Error('BILLING_PLAN_INVALID');
  const rawStatus = requiredString(subscription.status, 'BILLING_STATUS_REQUIRED');
  const status = STATUS_MAP[rawStatus];
  if (!status) throw new Error('BILLING_STATUS_UNSUPPORTED');
  const customerValue = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer && typeof subscription.customer === 'object'
      ? optionalString((subscription.customer as Record<string, unknown>).id)
      : undefined;
  return {
    workspaceId,
    provider: 'stripe',
    providerCustomerId: customerValue,
    providerSubscriptionId,
    plan,
    status,
    currentPeriodStart: epochMs(subscription.current_period_start),
    currentPeriodEnd: epochMs(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    sourceUpdatedAt: observedAt,
  };
}

export class StripeBillingProviderAdapter implements BillingProviderMutationAdapter, BillingProviderReadAdapter {
  readonly provider = 'stripe';
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: StripeBillingProviderConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
  ) {
    if (!config.secretKey.trim()) throw new Error('BILLING_STRIPE_SECRET_NOT_CONFIGURED');
    this.apiBaseUrl = (config.apiBaseUrl ?? 'https://api.stripe.com').replace(/\/$/, '');
    this.timeoutMs = Math.max(1_000, Math.min(60_000, Math.floor(config.timeoutMs ?? 15_000)));
  }

  async read(providerSubscriptionId: string) {
    const id = requiredString(providerSubscriptionId, 'BILLING_SUBSCRIPTION_ID_REQUIRED');
    const payload = await this.request(`/v1/subscriptions/${encodeURIComponent(id)}`, { method: 'GET' });
    return parseStripeSubscriptionState(payload, this.clock());
  }

  async mutate(input: BillingProviderMutationInput) {
    const id = requiredString(input.providerSubscriptionId, 'BILLING_SUBSCRIPTION_ID_REQUIRED');
    const idempotencyKey = requiredString(input.idempotencyKey, 'BILLING_IDEMPOTENCY_KEY_INVALID');
    const current = await this.request(`/v1/subscriptions/${encodeURIComponent(id)}`, { method: 'GET' });
    const body = this.mutationBody(input.operation, input.targetPlan, current);
    const updated = await this.request(`/v1/subscriptions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body,
      idempotencyKey,
    });
    return parseStripeSubscriptionState(updated, this.clock());
  }

  private mutationBody(operation: BillingMutationOperation, targetPlan: WorkspacePlanCode | undefined, current: StripeSubscription) {
    const body = new URLSearchParams();
    if (operation === 'change_plan') {
      if (!targetPlan || !ALLOWED_PLANS.has(targetPlan)) throw new Error('BILLING_TARGET_PLAN_REQUIRED');
      const priceId = this.config.priceByPlan[targetPlan]?.trim();
      if (!priceId) throw new Error('BILLING_STRIPE_PRICE_NOT_CONFIGURED');
      const itemId = requiredString(firstSubscriptionItem(current).id, 'BILLING_STRIPE_ITEM_ID_REQUIRED');
      body.set('items[0][id]', itemId);
      body.set('items[0][price]', priceId);
      body.set('metadata[photox_plan]', targetPlan);
      body.set('cancel_at_period_end', 'false');
      body.set('proration_behavior', 'create_prorations');
    } else if (operation === 'cancel_at_period_end') {
      body.set('cancel_at_period_end', 'true');
    } else if (operation === 'resume') {
      body.set('cancel_at_period_end', 'false');
    } else {
      throw new Error('BILLING_OPERATION_UNSUPPORTED');
    }
    return body;
  }

  private async request(
    path: string,
    input: { method: 'GET' | 'POST'; body?: URLSearchParams; idempotencyKey?: string },
  ): Promise<StripeSubscription> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          ...(input.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
        },
        body: input.body?.toString(),
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error('BILLING_STRIPE_RESPONSE_INVALID');
      }
      if (!response.ok) {
        const type = payload && typeof payload === 'object'
          ? optionalString(((payload as Record<string, unknown>).error as Record<string, unknown> | undefined)?.type)
          : undefined;
        throw new Error(type ? `BILLING_STRIPE_REQUEST_FAILED:${type}` : 'BILLING_STRIPE_REQUEST_FAILED');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('BILLING_STRIPE_RESPONSE_INVALID');
      return payload as StripeSubscription;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('BILLING_STRIPE_REQUEST_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function stripeBillingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StripeBillingProviderConfig {
  const secretKey = env.PHOTOX_STRIPE_SECRET_KEY?.trim() ?? '';
  return {
    secretKey,
    priceByPlan: {
      free: env.PHOTOX_STRIPE_PRICE_FREE?.trim(),
      personal: env.PHOTOX_STRIPE_PRICE_PERSONAL?.trim(),
      pro: env.PHOTOX_STRIPE_PRICE_PRO?.trim(),
      family: env.PHOTOX_STRIPE_PRICE_FAMILY?.trim(),
      team: env.PHOTOX_STRIPE_PRICE_TEAM?.trim(),
    },
  };
}
