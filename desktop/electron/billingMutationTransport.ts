import type { WorkspacePlanCode } from '@photosync/core';
import type { BillingMutationOperation, BillingMutationRequest } from './billingMutationCoordinator.js';

export type PublicBillingMutationInput = {
  operation: BillingMutationOperation;
  targetPlan?: WorkspacePlanCode;
};

export type BillingMutationServerBinding = {
  workspaceId: string;
  provider: string;
  providerSubscriptionId: string;
};

const OPERATIONS = new Set<BillingMutationOperation>(['change_plan', 'cancel_at_period_end', 'resume']);
const PLANS = new Set<WorkspacePlanCode>(['free', 'personal', 'pro', 'family', 'team']);
const ALLOWED_BODY_KEYS = new Set(['operation', 'targetPlan']);
const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

function requirePlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BILLING_MUTATION_BODY_INVALID');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('BILLING_MUTATION_BODY_INVALID');
  return value as Record<string, unknown>;
}

export function parsePublicBillingMutationInput(body: unknown, idempotencyHeader: unknown): {
  input: PublicBillingMutationInput;
  idempotencyKey: string;
} {
  const raw = requirePlainObject(body);
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_BODY_KEYS.has(key)) throw new Error('BILLING_MUTATION_BODY_FIELD_FORBIDDEN');
  }

  const operation = String(raw.operation ?? '') as BillingMutationOperation;
  if (!OPERATIONS.has(operation)) throw new Error('BILLING_MUTATION_OPERATION_INVALID');

  const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : '';
  if (idempotencyKey.length < IDEMPOTENCY_KEY_MIN_LENGTH || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new Error('BILLING_IDEMPOTENCY_KEY_INVALID');
  }

  if (operation === 'change_plan') {
    const targetPlan = String(raw.targetPlan ?? '') as WorkspacePlanCode;
    if (!PLANS.has(targetPlan)) throw new Error('BILLING_TARGET_PLAN_INVALID');
    return { input: { operation, targetPlan }, idempotencyKey };
  }

  if (raw.targetPlan !== undefined) throw new Error('BILLING_TARGET_PLAN_NOT_ALLOWED');
  return { input: { operation }, idempotencyKey };
}

export function bindBillingMutationRequest(
  binding: BillingMutationServerBinding,
  publicInput: PublicBillingMutationInput,
  idempotencyKey: string,
): BillingMutationRequest {
  if (!binding.workspaceId.trim() || !binding.provider.trim() || !binding.providerSubscriptionId.trim()) {
    throw new Error('BILLING_PROVIDER_BINDING_REQUIRED');
  }
  return {
    workspaceId: binding.workspaceId,
    provider: binding.provider,
    providerSubscriptionId: binding.providerSubscriptionId,
    operation: publicInput.operation,
    targetPlan: publicInput.targetPlan,
    idempotencyKey,
  };
}

export function billingMutationHttpStatus(error: unknown): number {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'ROLE_FORBIDDEN' || code === 'WORKSPACE_ROLE_STALE' || code === 'MEMBERSHIP_INACTIVE') return 403;
  if (code === 'SUBSCRIPTION_NOT_FOUND') return 404;
  if (code === 'BILLING_MUTATION_IN_PROGRESS') return 409;
  if (code === 'BILLING_IDEMPOTENCY_KEY_REUSED') return 409;
  if (
    code === 'BILLING_MUTATION_BODY_INVALID' ||
    code === 'BILLING_MUTATION_BODY_FIELD_FORBIDDEN' ||
    code === 'BILLING_MUTATION_OPERATION_INVALID' ||
    code === 'BILLING_IDEMPOTENCY_KEY_INVALID' ||
    code === 'BILLING_TARGET_PLAN_INVALID' ||
    code === 'BILLING_TARGET_PLAN_REQUIRED' ||
    code === 'BILLING_TARGET_PLAN_NOT_ALLOWED'
  ) return 400;
  if (code === 'BILLING_PROVIDER_NOT_CONFIGURED') return 503;
  return 502;
}
