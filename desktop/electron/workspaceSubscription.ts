import type { WorkspacePlanCode, WorkspaceRole } from '@photosync/core';
import type { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';

export type WorkspaceSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'canceled'
  | 'incomplete';

export type WorkspaceSubscriptionActor = {
  subject: string;
  workspaceId: string;
  workspaceRole?: WorkspaceRole;
  deviceId?: string;
};

export type WorkspaceSubscriptionSnapshot = {
  workspaceId: string;
  plan: WorkspacePlanCode;
  source: 'legacy' | 'billing';
  status: 'unmanaged' | WorkspaceSubscriptionStatus;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  updatedAt: number;
};

export type ProviderSubscriptionState = {
  workspaceId: string;
  provider: string;
  providerEventId?: string;
  providerCustomerId?: string;
  providerSubscriptionId: string;
  plan: WorkspacePlanCode;
  status: WorkspaceSubscriptionStatus;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  sourceUpdatedAt: number;
};

export type EndOfPeriodEntitlementTransition = {
  workspaceId: string;
  provider: string;
  providerSubscriptionId: string;
  targetPlan: WorkspacePlanCode;
  effectiveAt: number;
};

const ADMIN_ROLES = new Set<WorkspaceRole>(['owner', 'admin']);
const ENTITLEMENT_ACTIVE_STATUSES = new Set<WorkspaceSubscriptionStatus>(['trialing', 'active', 'past_due']);

export class WorkspaceSubscriptionService {
  constructor(
    private readonly store: SqlitePhotoXStore,
    private readonly workspaces: SqliteWorkspaceRepository,
  ) {
    this.migrate();
  }

  private migrate() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_workspace_subscriptions (
        workspace_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_customer_id TEXT,
        provider_subscription_id TEXT NOT NULL,
        plan_code TEXT NOT NULL,
        status TEXT NOT NULL,
        current_period_start INTEGER,
        current_period_end INTEGER,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        source_updated_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_photox_subscription_provider_id
        ON photox_workspace_subscriptions(provider, provider_subscription_id);
      CREATE TABLE IF NOT EXISTS photox_subscription_provider_events (
        provider TEXT NOT NULL,
        provider_event_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        source_updated_at INTEGER NOT NULL,
        applied INTEGER NOT NULL,
        result_code TEXT,
        processed_at INTEGER NOT NULL,
        PRIMARY KEY(provider, provider_event_id),
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_photox_subscription_events_workspace
        ON photox_subscription_provider_events(workspace_id, processed_at DESC);
    `);
  }

  private requireAdmin(actor: WorkspaceSubscriptionActor) {
    const membership = this.workspaces.getMembership(actor.workspaceId, actor.subject);
    if (!membership || membership.status !== 'active') throw new Error('MEMBERSHIP_INACTIVE');
    if (actor.workspaceRole && actor.workspaceRole !== membership.role) throw new Error('WORKSPACE_ROLE_STALE');
    if (!ADMIN_ROLES.has(membership.role)) throw new Error('ROLE_FORBIDDEN');
    return membership;
  }

  snapshot(actor: WorkspaceSubscriptionActor): WorkspaceSubscriptionSnapshot {
    this.requireAdmin(actor);
    const workspace = this.workspaces.getWorkspace(actor.workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    const row = this.store.db.prepare(`SELECT plan_code,status,current_period_start,current_period_end,
      cancel_at_period_end,updated_at FROM photox_workspace_subscriptions WHERE workspace_id=?`).get(actor.workspaceId) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        workspaceId: workspace.id,
        plan: workspace.plan,
        source: 'legacy',
        status: 'unmanaged',
        cancelAtPeriodEnd: false,
        updatedAt: workspace.updatedAt,
      };
    }
    return {
      workspaceId: workspace.id,
      plan: String(row.plan_code) as WorkspacePlanCode,
      source: 'billing',
      status: String(row.status) as WorkspaceSubscriptionStatus,
      currentPeriodStart: row.current_period_start == null ? undefined : Number(row.current_period_start),
      currentPeriodEnd: row.current_period_end == null ? undefined : Number(row.current_period_end),
      cancelAtPeriodEnd: Boolean(Number(row.cancel_at_period_end)),
      updatedAt: Number(row.updated_at),
    };
  }

  applyProviderState(input: ProviderSubscriptionState, now = Date.now()) {
    const workspace = this.workspaces.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      if (input.providerEventId) {
        const processed = this.store.db.prepare(`SELECT applied,result_code FROM photox_subscription_provider_events
          WHERE provider=? AND provider_event_id=?`).get(input.provider, input.providerEventId) as { applied?: number; result_code?: string | null } | undefined;
        if (processed) {
          this.store.db.exec('COMMIT');
          return { applied: false, reason: 'DUPLICATE_PROVIDER_EVENT' as const };
        }
      }

      const existing = this.store.db.prepare('SELECT source_updated_at FROM photox_workspace_subscriptions WHERE workspace_id=?').get(input.workspaceId) as { source_updated_at?: number } | undefined;
      if (existing?.source_updated_at != null && Number(existing.source_updated_at) >= input.sourceUpdatedAt) {
        if (input.providerEventId) {
          this.recordProviderEvent(input, false, 'STALE_PROVIDER_EVENT', now);
        }
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'STALE_PROVIDER_EVENT' as const };
      }

      this.store.db.prepare(`INSERT INTO photox_workspace_subscriptions(
        workspace_id,provider,provider_customer_id,provider_subscription_id,plan_code,status,
        current_period_start,current_period_end,cancel_at_period_end,source_updated_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        provider=excluded.provider,
        provider_customer_id=excluded.provider_customer_id,
        provider_subscription_id=excluded.provider_subscription_id,
        plan_code=excluded.plan_code,
        status=excluded.status,
        current_period_start=excluded.current_period_start,
        current_period_end=excluded.current_period_end,
        cancel_at_period_end=excluded.cancel_at_period_end,
        source_updated_at=excluded.source_updated_at,
        updated_at=excluded.updated_at`).run(
        input.workspaceId,
        input.provider,
        input.providerCustomerId ?? null,
        input.providerSubscriptionId,
        input.plan,
        input.status,
        input.currentPeriodStart ?? null,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ? 1 : 0,
        input.sourceUpdatedAt,
        now,
      );

      // Provider state can raise/maintain entitlements while service is active. Canceled/paused
      // states intentionally do not auto-downgrade here; end-of-period policy is an explicit control-plane transition.
      if (ENTITLEMENT_ACTIVE_STATUSES.has(input.status) && workspace.plan !== input.plan) {
        this.store.db.prepare('UPDATE photox_workspaces SET plan=?, updated_at=? WHERE id=?').run(input.plan, now, input.workspaceId);
      }
      if (input.providerEventId) {
        this.recordProviderEvent(input, true, null, now);
      }
      this.workspaces.appendAudit({
        workspaceId: input.workspaceId,
        actorUserId: 'system:billing',
        action: 'subscription.state.updated',
        targetType: 'workspace_subscription',
        targetId: input.workspaceId,
        metadata: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          plan: input.plan,
          status: input.status,
          cancelAtPeriodEnd: Boolean(input.cancelAtPeriodEnd),
          sourceUpdatedAt: input.sourceUpdatedAt,
        },
        createdAt: now,
      });
      this.store.db.exec('COMMIT');
      return { applied: true as const };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  applyEndOfPeriodEntitlementTransition(input: EndOfPeriodEntitlementTransition, now = Date.now()) {
    const workspace = this.workspaces.getWorkspace(input.workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.store.db.prepare(`SELECT provider,provider_subscription_id,status,current_period_end,cancel_at_period_end
        FROM photox_workspace_subscriptions WHERE workspace_id=?`).get(input.workspaceId) as Record<string, unknown> | undefined;
      if (!row) {
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'SUBSCRIPTION_NOT_FOUND' as const };
      }
      if (String(row.provider) !== input.provider || String(row.provider_subscription_id) !== input.providerSubscriptionId) {
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'SUBSCRIPTION_MISMATCH' as const };
      }
      if (String(row.status) !== 'canceled' || !Boolean(Number(row.cancel_at_period_end))) {
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'PERIOD_END_TRANSITION_NOT_SCHEDULED' as const };
      }
      const periodEnd = row.current_period_end == null ? undefined : Number(row.current_period_end);
      if (periodEnd == null || input.effectiveAt < periodEnd || now < periodEnd) {
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'PERIOD_NOT_ENDED' as const };
      }
      const currentWorkspace = this.workspaces.getWorkspace(input.workspaceId);
      if (!currentWorkspace) throw new Error('WORKSPACE_NOT_FOUND');
      if (currentWorkspace.plan === input.targetPlan) {
        this.store.db.exec('COMMIT');
        return { applied: false, reason: 'ALREADY_TRANSITIONED' as const };
      }

      this.store.db.prepare('UPDATE photox_workspaces SET plan=?, updated_at=? WHERE id=?').run(input.targetPlan, now, input.workspaceId);
      this.workspaces.appendAudit({
        workspaceId: input.workspaceId,
        actorUserId: 'system:billing',
        action: 'subscription.entitlements.period_end_applied',
        targetType: 'workspace_subscription',
        targetId: input.workspaceId,
        metadata: {
          provider: input.provider,
          providerSubscriptionId: input.providerSubscriptionId,
          previousPlan: currentWorkspace.plan,
          targetPlan: input.targetPlan,
          currentPeriodEnd: periodEnd,
          effectiveAt: input.effectiveAt,
        },
        createdAt: now,
      });
      this.store.db.exec('COMMIT');
      return { applied: true as const };
    } catch (error) {
      this.store.db.exec('ROLLBACK');
      throw error;
    }
  }

  private recordProviderEvent(input: ProviderSubscriptionState, applied: boolean, resultCode: string | null, now: number) {
    if (!input.providerEventId) return;
    this.store.db.prepare(`INSERT INTO photox_subscription_provider_events(
      provider,provider_event_id,workspace_id,source_updated_at,applied,result_code,processed_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
      input.provider,
      input.providerEventId,
      input.workspaceId,
      input.sourceUpdatedAt,
      applied ? 1 : 0,
      resultCode,
      now,
    );
  }
}
