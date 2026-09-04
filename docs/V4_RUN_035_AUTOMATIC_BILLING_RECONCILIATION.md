# PhotoX V4 Run 35 — Automatic billing reconciliation

## Scope

This batch continues Run 34. It closes the webhook-gap healing path before exposing authenticated billing mutations or billing UI.

## Implemented

- Added a dedicated system reconciliation path for control-plane jobs. It keeps the exact workspace/provider/provider-subscription binding checks used by interactive reconciliation but audits scheduled work as `system:billing-reconciliation` rather than impersonating a workspace owner.
- `DesktopWorkspaceAuth` now creates the Stripe read adapter and reconciliation service only when `PHOTOX_STRIPE_SECRET_KEY` is configured.
- Reconciliation runs once on startup and then periodically, healing missed or delayed Stripe webhook delivery from authoritative provider state.
- The periodic worker is overlap-safe: a slow provider read cannot start a second reconciliation for the same Desktop control plane.
- The worker refuses non-Stripe or missing subscription bindings and does not perform provider calls for unmanaged workspaces.
- Reconciled state still flows through `WorkspaceSubscriptionService.applyProviderState`, preserving monotonic ordering, provider-event replay protection, plan/entitlement rules, and audit invariants.
- Added lifecycle disposal hooks on `DesktopWorkspaceAuth` so reconciliation and entitlement timers can be cleared by the host during shutdown.
- Added `PHOTOX_BILLING_RECONCILIATION_INTERVAL_MS`; default is 15 minutes and runtime clamps it to 1 minute through 24 hours. Reconciliation remains disabled when the Stripe secret key is absent.
- No billing mutation API or billing control UI was exposed in this batch.

## Regression coverage

- Scheduled reconciliation applies authoritative provider state inside the bound workspace/subscription.
- Scheduled reconciliation records a system actor and scheduled source in audit rather than an owner actor.
- Cross-workspace provider state is rejected before mutation.
- Existing interactive owner/admin authorization coverage remains unchanged.

## Carry-forward P0 requirements

1. Google Drive allocation remains authoritative-provider based: default PhotoX allocation is 2/3 of total quota, constrained by actual remaining bytes and safety reserve, with configurable per-account ratio. Never restore a fixed 10 GB cap.
2. Google Photos migration remains Picker-selected source only, with append-only destination writes to Google Photos or transfer to a connected Google Drive account. Do not claim unrestricted full-library crawling.
3. Web continues to reuse the exact Desktop React component tree through `DesktopBridge`, authenticated HTTP/WebSocket adapters, Range streaming, workspace/session authorization, CORS/CSRF/rate limiting/audit where applicable.

## Intentional limits / remaining billing risks

- Provider reconciliation currently covers the Desktop-hosted workspace control plane; a future multi-workspace hosted control plane should enumerate tenant bindings through a durable job queue instead of per-process workspace state.
- Live Stripe API/webhook behavior remains NOT VERIFIED.
- Checkout/payment-method/customer-portal abstractions are not implemented.
- Authenticated billing mutation HTTP/IPC contracts are not exposed yet.

## Next prioritized batch

Expose billing mutations only through owner/admin authenticated contracts with CSRF and caller-supplied idempotency enforcement for Web, plus equivalent Electron IPC backing. Add integration tests proving role, tenant, CSRF, idempotency replay, and provider error behavior before adding Change plan / Cancel / Resume controls to the shared Desktop/Web UI. Then continue Mobile workspace navigation, member/invite lifecycle, provider/index tenant-ID isolation audit, and deployment/update hardening.
