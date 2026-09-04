# PhotoX V4 Run 34 — Stripe mutation adapter and reconciliation

## Scope

This batch continues Run 33. It completes the provider-facing Stripe adapter and an authoritative reconciliation path before exposing any billing mutation UI.

## Implemented

- Added `StripeBillingProviderAdapter` backed by Stripe REST using the server-side `PHOTOX_STRIPE_SECRET_KEY` only.
- Added explicit PhotoX plan -> Stripe Price ID mapping through `PHOTOX_STRIPE_PRICE_*` environment variables. Unknown/unconfigured prices fail closed.
- `change_plan` reads the authoritative Stripe subscription first, binds the existing subscription item, updates the Stripe price, writes `metadata[photox_plan]`, clears period-end cancellation, and uses provider idempotency.
- `cancel_at_period_end` and `resume` mutate only `cancel_at_period_end` and retain the same provider subscription.
- Every provider mutation forwards the coordinator idempotency key as Stripe `Idempotency-Key`.
- Stripe responses are parsed through a strict allow-list for PhotoX plans and supported subscription lifecycle states.
- Added bounded request timeout and generic provider error mapping; the Stripe secret is never returned or stored in PhotoX mutation/audit rows.
- Added `BillingReconciliationService` that reads authoritative provider state after webhook gaps or delayed delivery and applies it only after owner/admin authorization plus exact workspace/provider/subscription binding.
- Reconciliation state still flows through `WorkspaceSubscriptionService.applyProviderState`, retaining monotonic ordering, entitlement transition, and audit invariants.
- No browser/mobile mutation endpoint or billing control has been exposed yet.

## Regression coverage

- Change-plan sends the expected Stripe item/price/metadata form values and provider idempotency header.
- Cancel/resume only toggle period-end cancellation.
- Missing plan price and provider HTTP errors fail closed.
- Strict subscription parsing rejects unsupported PhotoX plans.
- Reconciliation updates plan/state only within the authoritative tenant/subscription binding.
- Cross-workspace provider state is rejected before mutation.
- Non-admin members are rejected before provider read.

## Deployment configuration

- `PHOTOX_STRIPE_SECRET_KEY`
- `PHOTOX_STRIPE_PRICE_FREE`
- `PHOTOX_STRIPE_PRICE_PERSONAL`
- `PHOTOX_STRIPE_PRICE_PRO`
- `PHOTOX_STRIPE_PRICE_FAMILY`
- `PHOTOX_STRIPE_PRICE_TEAM`

These values are main-process/control-plane configuration only and must never be exposed through DesktopBridge, Web renderer code, or Mobile.

## Intentional limits / remaining billing risks

- No checkout/payment-method/customer-portal abstraction yet.
- No authenticated Desktop/Web billing mutation route is enabled yet.
- Reconciliation is an authoritative primitive but is not yet scheduled periodically or automatically after webhook failure.
- Stripe API compatibility is covered with deterministic mocked REST tests; live Stripe billing remains NOT VERIFIED.

## Carry-forward P0 requirements

1. Google Drive allocation remains authoritative-provider based: default PhotoX allocation is 2/3 of total quota, constrained by actual remaining bytes and safety reserve, with configurable per-account ratio. Never restore a fixed 10 GB cap.
2. Google Photos migration remains Picker-selected source only, with append-only destination writes to Google Photos or transfer to a connected Google Drive account. Do not claim unrestricted full-library crawling.
3. Web continues to reuse the exact Desktop React component tree through `DesktopBridge`, authenticated HTTP/WebSocket adapters, Range streaming, workspace/session authorization, CORS/CSRF/rate limiting/audit where applicable.

## Next prioritized batch

Wire safe reconciliation scheduling/triggering around webhook delivery gaps, then add authenticated billing mutation API contracts only after CSRF/role/idempotency enforcement is covered. Billing UI should remain disabled until those routes and provider behavior are green. Then continue Mobile workspace navigation, member/invite lifecycle, provider/index tenant-ID isolation audit, and deployment/update hardening.
