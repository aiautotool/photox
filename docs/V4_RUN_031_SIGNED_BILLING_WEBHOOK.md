# V4 Run 31 — Signed billing webhook ingress

## Scope completed

This batch continues Run 30's authoritative subscription control-plane work. It does not add billing controls to the renderer.

- Added a Stripe-specific webhook verifier that authenticates the exact raw HTTP request bytes with HMAC-SHA256 and the endpoint signing secret.
- Signature parsing accepts Stripe's timestamp plus one or more `v1` signatures and uses timing-safe comparison.
- Signed payloads outside the configured five-minute tolerance fail closed.
- The event parser accepts only subscription created/updated/deleted events and validates event id, creation timestamp, subscription id, PhotoX workspace metadata, PhotoX plan, lifecycle status and optional period fields before returning `ProviderSubscriptionState`.
- Supported PhotoX plans are explicitly allow-listed: `free`, `personal`, `pro`, `family`, `team`.
- `customer.subscription.deleted` is normalized to canceled state; arbitrary event types and plan strings are rejected.
- `DesktopWorkspaceAuth.handleStripeWebhook` is the only bridge from verified provider input to `WorkspaceSubscriptionService.applyProviderState`, preserving the durable event-id replay ledger and monotonic state handling added in Run 30.
- Added public provider ingress at `POST /api/web/v1/billing/webhooks/stripe`. It intentionally does not use browser bearer auth or CSRF; provider authentication is the raw-body signature. Existing edge rate limiting and request-size limits still apply.
- Rejected provider requests return a generic error rather than exposing verifier or subscription internals.
- Added `PHOTOX_STRIPE_WEBHOOK_SECRET` to `desktop/.env.example`; the secret is consumed only in Electron/control-plane code and is not exposed through DesktopBridge, renderer or Mobile.
- No upgrade/change-plan/payment/cancel/resume UI was introduced.

## Regression coverage

`desktop/electron/billingWebhook.test.ts` covers:

- exact raw-body signature verification;
- body tampering rejection;
- timestamp expiry rejection;
- strict subscription-event mapping;
- deleted-subscription normalization;
- unsupported event and arbitrary-plan rejection;
- missing signing-secret fail-closed behavior.

`desktop/electron/webEdgeBillingWebhook.test.ts` covers:

- provider ingress without browser bearer/CSRF;
- exact raw body and signature forwarding;
- missing-signature rejection before backing mutation;
- service-unavailable response when the signing secret is not configured.

## P0 requirements carried forward

1. Google Drive allocation remains based on authoritative Google total quota, with default PhotoX ratio `2/3`, bounded by actual provider remaining bytes and safety reserve, and configurable per account. There is no fixed 10 GB cap.
2. Google Photos migration remains Picker-selected only. Destinations remain append-only Google Photos or a connected Google Drive account; unrestricted full-library crawling must not be advertised.
3. Web continues to reuse the Desktop React UI through the shared `DesktopBridge`, authenticated HTTP/WebSocket adapters and workspace/session security boundaries, while media Range streaming remains preserved.

## Next prioritized batch

1. Add a durable scheduler/control-plane worker for due end-of-period entitlement transitions with an explicit target-plan policy and restart-safe/idempotent execution.
2. Harden provider ordering for distinct events that share the same provider timestamp so legitimate same-second events are not silently dropped.
3. Only after those paths are authoritative, add billing mutation abstractions and then carefully permissioned UI controls.
4. Continue Mobile workspace navigation, member/invite lifecycle, and provider/index tenant-identifier audit.

## Validation

The completed batch must be considered green only after repository CI on the final documentation HEAD passes install, unit/integration tests, full TypeScript typecheck and production build.

## Not verified

- Live Stripe webhook delivery from a real provider account/endpoint.
- Live Google Photos OAuth/migration against real accounts.
- Signed iOS IPA/Xcode release build.
- Signed Android APK/AAB release build.
