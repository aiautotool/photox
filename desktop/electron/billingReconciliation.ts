import type { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import type { BillingProviderReadAdapter } from './stripeBillingProvider.js';
import {
  WorkspaceSubscriptionService,
  type WorkspaceSubscriptionActor,
} from './workspaceSubscription.js';

export type BillingReconciliationResult = {
  applied: boolean;
  reason?: 'STALE_PROVIDER_EVENT' | 'DUPLICATE_PROVIDER_EVENT';
};

type BillingReconciliationInput = {
  workspaceId: string;
  provider: string;
  providerSubscriptionId: string;
};

export class BillingReconciliationService {
  constructor(
    private readonly store: SqlitePhotoXStore,
    private readonly workspaces: SqliteWorkspaceRepository,
    private readonly subscriptions: WorkspaceSubscriptionService,
  ) {}

  async reconcile(
    actor: WorkspaceSubscriptionActor,
    input: BillingReconciliationInput,
    adapter: BillingProviderReadAdapter,
    now = Date.now(),
  ): Promise<BillingReconciliationResult> {
    if (actor.workspaceId !== input.workspaceId) throw new Error('WORKSPACE_SCOPE_MISMATCH');
    this.subscriptions.snapshot(actor); // authoritative membership + owner/admin authorization
    return this.reconcileBoundSubscription(input, adapter, {
      actorUserId: actor.subject,
      actorDeviceId: actor.deviceId,
      source: 'interactive',
    }, now);
  }

  async reconcileSystem(
    input: BillingReconciliationInput,
    adapter: BillingProviderReadAdapter,
    now = Date.now(),
  ): Promise<BillingReconciliationResult> {
    const workspace = this.workspaces.getWorkspace(input.workspaceId);
    if (!workspace || workspace.status !== 'active') throw new Error('WORKSPACE_INACTIVE');
    return this.reconcileBoundSubscription(input, adapter, {
      actorUserId: 'system:billing-reconciliation',
      source: 'scheduled',
    }, now);
  }

  private async reconcileBoundSubscription(
    input: BillingReconciliationInput,
    adapter: BillingProviderReadAdapter,
    audit: { actorUserId: string; actorDeviceId?: string; source: 'interactive' | 'scheduled' },
    now: number,
  ): Promise<BillingReconciliationResult> {
    if (adapter.provider !== input.provider) throw new Error('BILLING_PROVIDER_ADAPTER_MISMATCH');

    const binding = this.store.db.prepare(`SELECT provider,provider_subscription_id
      FROM photox_workspace_subscriptions WHERE workspace_id=?`).get(input.workspaceId) as
      { provider?: string; provider_subscription_id?: string } | undefined;
    if (!binding) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (binding.provider !== input.provider || binding.provider_subscription_id !== input.providerSubscriptionId) {
      throw new Error('SUBSCRIPTION_MISMATCH');
    }

    const providerState = await adapter.read(input.providerSubscriptionId);
    if (
      providerState.workspaceId !== input.workspaceId ||
      providerState.provider !== input.provider ||
      providerState.providerSubscriptionId !== input.providerSubscriptionId
    ) {
      throw new Error('BILLING_PROVIDER_STATE_SCOPE_MISMATCH');
    }

    const applied = this.subscriptions.applyProviderState(providerState, now);
    this.workspaces.appendAudit({
      workspaceId: input.workspaceId,
      actorUserId: audit.actorUserId,
      actorDeviceId: audit.actorDeviceId,
      action: 'subscription.reconciliation.completed',
      targetType: 'workspace_subscription',
      targetId: input.workspaceId,
      metadata: {
        provider: input.provider,
        applied: applied.applied,
        result: applied.applied ? 'APPLIED' : applied.reason,
        source: audit.source,
      },
      createdAt: now,
    });
    return applied.applied ? { applied: true } : { applied: false, reason: applied.reason };
  }
}
