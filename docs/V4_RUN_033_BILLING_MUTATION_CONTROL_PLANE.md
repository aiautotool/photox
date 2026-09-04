# PhotoX V4 Run 33 — Durable billing mutation control-plane

## Scope

This batch continues Run 32 without enabling billing UI. It adds the provider-facing mutation coordination primitive that must exist before any upgrade, cancel, resume, or change-plan control can be exposed.

## Implemented

- Added `BillingMutationCoordinator` with explicit operations for `change_plan`, `cancel_at_period_end`, and `resume`.
- Every mutation requires a caller-supplied provider idempotency key; PhotoX forwards the original key to the provider adapter but persists only its SHA-256 digest.
- Added a durable SQLite mutation ledger keyed by `(workspace_id, idempotency_key_hash)` with request fingerprint, operation, target plan, attempt count, lifecycle status, provider-state result, and timestamps.
- Reusing an idempotency key for a different request payload fails closed with `BILLING_IDEMPOTENCY_KEY_REUSED`.
- Replaying a successful request returns the durable prior result without invoking the provider again.
- A fresh pending request is treated as in-progress. A stale pending request can be retried with the same provider idempotency key, allowing crash recovery without creating a different provider operation.
- Failed provider calls may be retried with the same key and exact payload; attempt count is durable.
- Provider adapter and returned provider state are bound to the authoritative workspace + provider + provider subscription ID before state can be applied.
- Owner/admin membership authorization is enforced through the existing authoritative subscription service before provider invocation.
- Successful provider state is fed back through `WorkspaceSubscriptionService.applyProviderState`, preserving webhook ordering, provider-event idempotency, entitlement, and audit invariants.
- Audit events record mutation operation/result but never persist the raw idempotency key or provider customer identifiers.

## Regression coverage

- Provider mutation is invoked once and a successful retry is served from the durable ledger.
- Raw idempotency keys are not stored in the ledger or audit metadata.
- The same key cannot be reused for a different operation/target plan.
- Provider-returned state cannot cross workspace/provider/subscription scope.
- Failed requests can retry safely with the same key and increment durable attempt count.
- Non-admin members are rejected before the provider adapter can run.

## Intentional limits

- No renderer/mobile billing mutations are exposed yet.
- No live Stripe mutation adapter is connected yet; the coordinator is provider-agnostic by design.
- No checkout/payment-method UI is created.
- Provider reconciliation after missed webhooks is still the next control-plane gap.

## Carry-forward P0 requirements

1. Google Drive allocation remains based on authoritative provider quota: PhotoX default allocation is 2/3 of total quota, constrained by actual remaining bytes and safety reserve, with configurable per-account ratio. Never restore a fixed 10 GB cap.
2. Google Photos migration remains Picker-selected source only, with append-only destination writes to Google Photos or transfer to a connected Google Drive account. Do not claim unrestricted full-library crawling.
3. Web continues to reuse the exact Desktop React component tree through `DesktopBridge`, with authenticated HTTP/WebSocket adapters, Range streaming, workspace/session authorization, CORS/CSRF/rate limiting/audit where applicable.

## Next prioritized batch

Add a Stripe mutation adapter and safe provider reconciliation path for missed/delayed webhooks. Keep mutation endpoints disabled until provider-side lifecycle behavior and reconciliation are covered end to end. Then continue Mobile workspace navigation, member/invite lifecycle, provider/index tenant-ID isolation audit, and deployment/update hardening.
