# V4 Run 037 — Billing Mutation Transport Wiring

## Goal

Continue the Run 036 strict public billing mutation contract by wiring it to real Desktop IPC and authenticated Web transport without exposing server-authoritative Stripe/workspace/subscription binding to clients.

## Implemented

- `DesktopWorkspaceAuth` now owns the durable `BillingMutationCoordinator` and connects it to the configured `StripeBillingProviderAdapter`.
- Mutation requests derive workspace/provider/provider-subscription binding from the authoritative workspace subscription row; renderer/browser input cannot select those values.
- Electron IPC channel `photosync:workspace-subscription-mutate` uses the trusted active Desktop workspace actor.
- Preload exposes the mutation operation without provider secrets or identifiers.
- Shared `DesktopBridge` now defines the same mutation method for Desktop and Web.
- Web bridge posts to `/api/web/v1/workspace/subscription/mutations` and carries the raw idempotency key only as the `Idempotency-Key` transport header.
- Web Edge route requires authenticated owner/admin role and browser CSRF before mutation execution.
- CORS now permits `Idempotency-Key`, avoiding browser preflight rejection.
- Domain/transport error mapping is used for billing mutation responses instead of treating provider/validation failures as authentication failures.
- Web transport tests cover anonymous rejection, missing CSRF, member rejection, public request body boundaries, idempotency header forwarding, CORS preflight, and conflict mapping.
- Shared bridge regression verifies idempotency metadata is not serialized into the public mutation body.

## Still intentionally gated

No Change plan / Cancel / Resume React controls are enabled in this run. UI should be added only after this final HEAD passes full tests/typecheck/build/CI and should implement the loading/error/replay/authoritative-refresh states from `V4_UI_SPEC.md`.

Checkout, payment method management and customer portal are not part of this mutation transport.

## Permanent V4 requirements retained

- Google Drive: default PhotoX allocation remains 2/3 of provider-authoritative total quota, bounded by real remaining provider bytes and safety reserve, configurable per account; no fixed 10 GB cap.
- Google Photos migration: Picker-selected source media only; append-only Google Photos destination or connected Drive destination; no unrestricted library crawling claim.
- Web: exact shared Desktop React UI/DesktopBridge architecture with authenticated HTTP/WebSocket, configurable exposure, Range streaming, workspace roles, CORS/CSRF/rate limiting/audit.

## Verification gate

Run full repository unit/integration tests, TypeScript typecheck, production build and GitHub Actions CI on the final `v4` HEAD. Any failed step must be fixed and rerun. Signed iOS/Android releases and live Stripe/Google Photos account integrations remain NOT VERIFIED unless separately exercised.
