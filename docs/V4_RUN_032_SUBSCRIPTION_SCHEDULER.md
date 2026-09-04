# PhotoX V4 Run 32 — Restart-safe subscription maintenance

## Scope

This batch continues the authoritative subscription control-plane work after signed Stripe webhook ingress. It intentionally does not add upgrade, payment, cancel, resume, or change-plan controls.

## Implemented

- Durable period-end transition marker on each workspace subscription.
- Restart-safe maintenance scan that finds provider-confirmed canceled subscriptions whose `current_period_end` has passed and applies the explicit entitlement target plan.
- Maintenance runs once during Desktop workspace-auth startup, then every 60 seconds while the process is alive. The timer is unreferenced so it cannot keep the app process alive by itself.
- Period-end target policy is explicit and configurable with `PHOTOX_BILLING_PERIOD_END_TARGET_PLAN`; default is `free`, and invalid plan codes fail closed.
- Repeated maintenance after a successful transition is a no-op because `entitlement_transitioned_at` is durable.
- Existing databases migrate in place by adding `provider_event_id` and `entitlement_transitioned_at` when missing.
- Distinct provider events that share the same provider timestamp now use provider event ID as a deterministic tie-breaker. This addresses Stripe event timestamps having second precision and makes delivery order converge to a single state instead of rejecting every equal-time event.
- Provider-event ledger idempotency remains authoritative; exact replay still returns `DUPLICATE_PROVIDER_EVENT` before mutation.

## Safety invariants

- No media or replica is deleted during plan transition.
- Entitlements cannot transition before the provider period end.
- Transition is still bound to workspace + provider + provider subscription ID.
- Canceled/paused webhook receipt alone does not immediately downgrade a workspace.
- No billing provider secret or customer/subscription identifier is exposed to renderer/mobile UI.

## Regression coverage

- Equal provider timestamps with different event IDs converge deterministically.
- Lower tie-break events are recorded as stale without state mutation.
- Period-end maintenance does nothing before due time.
- Due maintenance applies the target plan once.
- Reconstructing `WorkspaceSubscriptionService` against the same database simulates restart and confirms already-applied transitions are not scheduled again.

## Carry-forward P0 requirements

1. Google Drive allocation remains based on authoritative provider quota: PhotoX default allocation is 2/3 of total quota, constrained by actual remaining bytes and safety reserve, with configurable per-account ratio. Never restore a fixed 10 GB cap.
2. Google Photos migration remains Picker-selected source only, with append-only destination writes to Google Photos or transfer to a connected Google Drive account. Do not claim unrestricted full-library crawling.
3. Web continues to reuse the exact Desktop React component tree through `DesktopBridge`, with authenticated HTTP/WebSocket adapters, Range streaming, workspace/session authorization, CORS/CSRF/rate limiting/audit where applicable.

## Next prioritized batch

Before enabling billing mutations/UI, add provider-side billing mutation abstractions with explicit idempotency keys and lifecycle tests, plus a safe reconciliation path for Stripe state after webhook gaps. Then continue Mobile workspace navigation, member/invite lifecycle, provider/index tenant-ID isolation audit, and remaining production deployment/update hardening.
