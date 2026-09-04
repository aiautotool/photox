import crypto from 'node:crypto';
import type { WorkspacePlanCode } from '@photosync/core';
import type { ProviderSubscriptionState, WorkspaceSubscriptionStatus } from './workspaceSubscription.js';

const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const ALLOWED_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);
const ALLOWED_PLANS = new Set<WorkspacePlanCode>(['free', 'personal', 'pro', 'team']);
const STATUS_MAP: Record<string, WorkspaceSubscriptionStatus | undefined> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
  incomplete: 'incomplete',
  unpaid: 'past_due',
};

type StripeEnvelope = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: { object?: Record<string, unknown> };
};

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

function parseSignatureHeader(header: string) {
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && /^[a-f0-9]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (!timestamp || !signatures.length) throw new Error('BILLING_WEBHOOK_SIGNATURE_INVALID');
  return { timestamp, signatures };
}

export function verifyStripeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  now = Date.now(),
  toleranceSeconds = STRIPE_SIGNATURE_TOLERANCE_SECONDS,
) {
  if (!secret) throw new Error('BILLING_WEBHOOK_NOT_CONFIGURED');
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);
  const ageSeconds = Math.abs(Math.floor(now / 1000) - timestamp);
  if (ageSeconds > toleranceSeconds) throw new Error('BILLING_WEBHOOK_SIGNATURE_EXPIRED');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  const valid = signatures.some(candidate => {
    const candidateBytes = Buffer.from(candidate, 'hex');
    return candidateBytes.length === expectedBytes.length && crypto.timingSafeEqual(candidateBytes, expectedBytes);
  });
  if (!valid) throw new Error('BILLING_WEBHOOK_SIGNATURE_INVALID');
  return timestamp;
}

export function parseStripeSubscriptionWebhook(rawBody: Buffer, signatureHeader: string, secret: string, now = Date.now()): ProviderSubscriptionState {
  verifyStripeWebhookSignature(rawBody, signatureHeader, secret, now);
  let event: StripeEnvelope;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as StripeEnvelope;
  } catch {
    throw new Error('BILLING_WEBHOOK_JSON_INVALID');
  }

  const eventId = requiredString(event.id, 'BILLING_EVENT_ID_REQUIRED');
  const eventType = requiredString(event.type, 'BILLING_EVENT_TYPE_REQUIRED');
  if (!ALLOWED_EVENT_TYPES.has(eventType)) throw new Error('BILLING_EVENT_UNSUPPORTED');
  if (typeof event.created !== 'number' || !Number.isFinite(event.created) || event.created <= 0) throw new Error('BILLING_EVENT_CREATED_INVALID');
  const subscription = event.data?.object;
  if (!subscription || typeof subscription !== 'object') throw new Error('BILLING_SUBSCRIPTION_REQUIRED');

  const subscriptionId = requiredString(subscription.id, 'BILLING_SUBSCRIPTION_ID_REQUIRED');
  const metadata = subscription.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('BILLING_METADATA_REQUIRED');
  const meta = metadata as Record<string, unknown>;
  const workspaceId = requiredString(meta.photox_workspace_id, 'BILLING_WORKSPACE_ID_REQUIRED');
  const plan = requiredString(meta.photox_plan, 'BILLING_PLAN_REQUIRED') as WorkspacePlanCode;
  if (!ALLOWED_PLANS.has(plan)) throw new Error('BILLING_PLAN_INVALID');

  const rawStatus = eventType === 'customer.subscription.deleted' ? 'canceled' : requiredString(subscription.status, 'BILLING_STATUS_REQUIRED');
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
    providerEventId: eventId,
    providerCustomerId: customerValue,
    providerSubscriptionId: subscriptionId,
    plan,
    status,
    currentPeriodStart: epochMs(subscription.current_period_start),
    currentPeriodEnd: epochMs(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    sourceUpdatedAt: Math.floor(event.created * 1000),
  };
}
