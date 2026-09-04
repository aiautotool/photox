import crypto from 'node:crypto';
import type { WorkspacePlanCode } from '@photosync/core';
import type { SqlitePhotoXStore, SqliteWorkspaceRepository } from '@photox/persistence-sqlite';
import {
  WorkspaceSubscriptionService,
  type ProviderSubscriptionState,
  type WorkspaceSubscriptionActor,
} from './workspaceSubscription.js';

export type BillingMutationOperation = 'change_plan' | 'cancel_at_period_end' | 'resume';

export type BillingMutationRequest = {
  workspaceId: string;
  provider: string;
  providerSubscriptionId: string;
  operation: BillingMutationOperation;
  targetPlan?: WorkspacePlanCode;
  idempotencyKey: string;
};

export type BillingProviderMutationInput = {
  providerSubscriptionId: string;
  operation: BillingMutationOperation;
  targetPlan?: WorkspacePlanCode;
  idempotencyKey: string;
};

export interface BillingProviderMutationAdapter {
  readonly provider: string;
  mutate(input: BillingProviderMutationInput): Promise<ProviderSubscriptionState>;
}

export type BillingMutationResult = {
  status: 'succeeded';
  replayed: boolean;
  attempts: number;
  providerStateResult: 'APPLIED' | 'DUPLICATE_PROVIDER_EVENT' | 'STALE_PROVIDER_EVENT';
};

const IDEMPOTENCY_KEY_MIN_LENGTH = 16;
const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
const STALE_PENDING_AFTER_MS = 5 * 60_000;

function digest(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requestFingerprint(input: BillingMutationRequest) {
  return digest(JSON.stringify({
    workspaceId: input.workspaceId,
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId,
    operation: input.operation,
    targetPlan: input.targetPlan ?? null,
  }));
}

function validateRequest(input: BillingMutationRequest) {
  const key = input.idempotencyKey.trim();
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new Error('BILLING_IDEMPOTENCY_KEY_INVALID');
  }
  if (input.operation === 'change_plan' && !input.targetPlan) throw new Error('BILLING_TARGET_PLAN_REQUIRED');
  if (input.operation !== 'change_plan' && input.targetPlan) throw new Error('BILLING_TARGET_PLAN_NOT_ALLOWED');
  if (!input.provider.trim() || !input.providerSubscriptionId.trim()) throw new Error('BILLING_PROVIDER_BINDING_REQUIRED');
  return key;
}

export class BillingMutationCoordinator {
  constructor(
    private readonly store: SqlitePhotoXStore,
    private readonly workspaces: SqliteWorkspaceRepository,
    private readonly subscriptions: WorkspaceSubscriptionService,
  ) {
    this.migrate();
  }

  private migrate() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS photox_subscription_mutations (
        workspace_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_subscription_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_plan TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        provider_state_source_updated_at INTEGER,
        result_code TEXT,
        last_error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(workspace_id, idempotency_key_hash),
        FOREIGN KEY(workspace_id) REFERENCES photox_workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_photox_subscription_mutations_status
        ON photox_subscription_mutations(status, updated_at ASC);
    `);
  }

  async execute(
    actor: WorkspaceSubscriptionActor,
    input: BillingMutationRequest,
    adapter: BillingProviderMutationAdapter,
    now = Date.now(),
  ): Promise<BillingMutationResult> {
    if (actor.workspaceId !== input.workspaceId) throw new Error('WORKSPACE_SCOPE_MISMATCH');
    this.subscriptions.snapshot(actor); // authoritative active-membership + owner/admin check
    const rawKey = validateRequest(input);
    if (adapter.provider !== input.provider) throw new Error('BILLING_PROVIDER_ADAPTER_MISMATCH');

    const binding = this.store.db.prepare(`SELECT provider,provider_subscription_id
      FROM photox_workspace_subscriptions WHERE workspace_id=?`).get(input.workspaceId) as
      { provider?: string; provider_subscription_id?: string } | undefined;
    if (!binding) throw new Error('SUBSCRIPTION_NOT_FOUND');
    if (binding.provider !== input.provider || binding.provider_subscription_id !== input.providerSubscriptionId) {
      throw new Error('SUBSCRIPTION_MISMATCH');
    }

    const keyHash = digest(rawKey);
    const fingerprint = requestFingerprint(input);
    const existing = this.store.db.prepare(`SELECT request_fingerprint,status,attempts,result_code,updated_at
      FROM photox_subscription_mutations WHERE workspace_id=? AND idempotency_key_hash=?`)
      .get(input.workspaceId, keyHash) as Record<string, unknown> | undefined;

    if (existing && String(existing.request_fingerprint) !== fingerprint) {
      throw new Error('BILLING_IDEMPOTENCY_KEY_REUSED');
    }
    if (existing?.status === 'succeeded') {
      return {
        status: 'succeeded',
        replayed: true,
        attempts: Number(existing.attempts),
        providerStateResult: String(existing.result_code) as BillingMutationResult['providerStateResult'],
      };
    }
    if (existing?.status === 'pending' && now - Number(existing.updated_at) < STALE_PENDING_AFTER_MS) {
      throw new Error('BILLING_MUTATION_IN_PROGRESS');
    }

    const attempts = Number(existing?.attempts ?? 0) + 1;
    if (existing) {
      this.store.db.prepare(`UPDATE photox_subscription_mutations SET status='pending',attempts=?,last_error_code=NULL,updated_at=?
        WHERE workspace_id=? AND idempotency_key_hash=?`).run(attempts, now, input.workspaceId, keyHash);
    } else {
      this.store.db.prepare(`INSERT INTO photox_subscription_mutations(
        workspace_id,idempotency_key_hash,request_fingerprint,provider,provider_subscription_id,operation,target_plan,
        status,attempts,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.workspaceId,
        keyHash,
        fingerprint,
        input.provider,
        input.providerSubscriptionId,
        input.operation,
        input.targetPlan ?? null,
        'pending',
        attempts,
        now,
        now,
      );
    }

    try {
      const providerState = await adapter.mutate({
        providerSubscriptionId: input.providerSubscriptionId,
        operation: input.operation,
        targetPlan: input.targetPlan,
        idempotencyKey: rawKey,
      });
      if (
        providerState.workspaceId !== input.workspaceId ||
        providerState.provider !== input.provider ||
        providerState.providerSubscriptionId !== input.providerSubscriptionId
      ) {
        throw new Error('BILLING_PROVIDER_STATE_SCOPE_MISMATCH');
      }

      const applied = this.subscriptions.applyProviderState(providerState, now);
      const resultCode: BillingMutationResult['providerStateResult'] = applied.applied
        ? 'APPLIED'
        : applied.reason;
      this.store.db.prepare(`UPDATE photox_subscription_mutations SET
        status='succeeded',provider_state_source_updated_at=?,result_code=?,last_error_code=NULL,updated_at=?
        WHERE workspace_id=? AND idempotency_key_hash=?`).run(
        providerState.sourceUpdatedAt,
        resultCode,
        now,
        input.workspaceId,
        keyHash,
      );
      this.workspaces.appendAudit({
        workspaceId: input.workspaceId,
        actorUserId: actor.subject,
        actorDeviceId: actor.deviceId,
        action: 'subscription.mutation.succeeded',
        targetType: 'workspace_subscription',
        targetId: input.workspaceId,
        metadata: {
          provider: input.provider,
          operation: input.operation,
          targetPlan: input.targetPlan,
          attempts,
          providerStateResult: resultCode,
        },
        createdAt: now,
      });
      return { status: 'succeeded', replayed: false, attempts, providerStateResult: resultCode };
    } catch (error) {
      this.store.db.prepare(`UPDATE photox_subscription_mutations SET status='failed',last_error_code='PROVIDER_MUTATION_FAILED',updated_at=?
        WHERE workspace_id=? AND idempotency_key_hash=?`).run(now, input.workspaceId, keyHash);
      this.workspaces.appendAudit({
        workspaceId: input.workspaceId,
        actorUserId: actor.subject,
        actorDeviceId: actor.deviceId,
        action: 'subscription.mutation.failed',
        targetType: 'workspace_subscription',
        targetId: input.workspaceId,
        metadata: { provider: input.provider, operation: input.operation, attempts },
        createdAt: now,
      });
      throw error;
    }
  }
}
