import type { WorkspaceBillingMutationInput, WorkspaceOverviewSnapshot, WorkspaceSubscriptionSnapshot } from './bridge.js';

export type BillingPlan = NonNullable<WorkspaceBillingMutationInput['targetPlan']>;
export type BillingRole = WorkspaceOverviewSnapshot['membership']['role'];

export const billingPlans: ReadonlyArray<{ id: BillingPlan; label: string }> = [
  { id: 'personal', label: 'Personal' },
  { id: 'pro', label: 'Pro' },
  { id: 'family', label: 'Family' },
  { id: 'team', label: 'Team' },
];

export type BillingUiPermissions = {
  canManage: boolean;
  canChangePlan: boolean;
  canCancelAtPeriodEnd: boolean;
  canResume: boolean;
  reason?: string;
};

export function billingUiPermissions(
  subscription: WorkspaceSubscriptionSnapshot,
  role: BillingRole,
): BillingUiPermissions {
  if (role !== 'owner' && role !== 'admin') {
    return {
      canManage: false,
      canChangePlan: false,
      canCancelAtPeriodEnd: false,
      canResume: false,
      reason: 'Chỉ chủ sở hữu hoặc quản trị viên mới có thể thay đổi subscription.',
    };
  }
  if (subscription.source !== 'billing') {
    return {
      canManage: false,
      canChangePlan: false,
      canCancelAtPeriodEnd: false,
      canResume: false,
      reason: 'Workspace này chưa được liên kết với billing provider authoritative.',
    };
  }

  const canChangePlan = subscription.status !== 'canceled' && subscription.status !== 'unmanaged';
  const canCancelAtPeriodEnd = !subscription.cancelAtPeriodEnd
    && (subscription.status === 'active' || subscription.status === 'trialing' || subscription.status === 'past_due');
  const canResume = subscription.cancelAtPeriodEnd && subscription.status !== 'canceled';
  return { canManage: true, canChangePlan, canCancelAtPeriodEnd, canResume };
}

export function billingMutationFingerprint(input: WorkspaceBillingMutationInput): string {
  return `${input.operation}:${input.targetPlan ?? '-'}`;
}

export function createBillingMutationKey(input: WorkspaceBillingMutationInput, randomId: string): string {
  const normalizedRandomId = randomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
  const suffix = normalizedRandomId || 'fallback';
  return `photox-ui-${billingMutationFingerprint(input).replace(/[^a-zA-Z0-9_-]/g, '-')}-${suffix}`;
}
