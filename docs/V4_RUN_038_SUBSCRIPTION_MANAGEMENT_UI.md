# V4 Run 38 — Shared Subscription Management UI

## Starting point

- Continued from Run 37 billing mutation transport wiring.
- `v4` started at `2567b000d315622f1270a4d67b9eadfca223c1e2`.
- `v3` baseline remained `9e13a5917c550aa9cf3ec5a5d699db88bac23b72` and must remain unchanged.

## Analysis

The authoritative subscription snapshot, Stripe mutation coordinator/adapter, Electron IPC/preload bridge, shared `DesktopBridge`, and authenticated Web mutation route already existed. The missing production-safe piece was the user-facing mutation state machine. Keeping the Subscription card read-only was no longer necessary, but exposing controls without role/lifecycle gating, idempotent retry, and authoritative refresh would have violated the V4 UI contract.

## Implemented

### Shared Desktop/Web subscription controls

The existing shared `DevicesPage` Subscription card now supports real:

- Change plan
- Cancel at period end
- Resume subscription

The same React component therefore works in Electron and the Web edition through their respective `DesktopBridge` adapters.

### Authorization and lifecycle presentation

A pure `billingUiPermissions()` helper derives presentation state from the authoritative subscription snapshot plus current membership role.

- Owner/admin billing workspaces may see applicable mutations.
- Member/viewer roles never receive functional subscription mutation controls.
- Legacy/unmanaged subscriptions show an explanatory message.
- Canceled subscriptions do not expose change/resume controls.
- Cancel is hidden after `cancelAtPeriodEnd` is already true.
- Resume is shown only while a non-canceled subscription has `cancelAtPeriodEnd=true`.

Server-side authorization remains authoritative; renderer checks are UX gating only.

### Safe mutation state machine

- Lifecycle changes require confirmation.
- Mutation controls enter an explicit busy state.
- The UI does not optimistically change plan/status.
- After success, workspace and subscription snapshots are fetched again from the authoritative control-plane.
- Success messaging distinguishes a durable replay from a newly applied mutation.
- A failed mutation stores the request fingerprint and the caller-generated idempotency key in renderer memory and exposes an explicit retry action using that same key.
- Changing the requested plan clears the failed retry identity so the new payload receives a new idempotency key.

No provider binding, Stripe customer/subscription ID, provider secret, or server-side workspace binding is added to the public UI request.

### Responsive UI

Added shared styles for plan selection, primary/danger lifecycle actions, permission explanation, success/error state, and narrow Desktop/Web layouts.

## Tests

Renderer-level regression coverage now checks:

- only owner/admin billing workspaces are mutation-capable in the UI model;
- active/cancel-at-period-end/canceled lifecycle states expose the correct actions;
- UI idempotency keys are sufficiently long, deterministic for the same supplied random identity, distinct for different identities, and do not embed workspace/provider binding.

The renderer test TypeScript project includes the new helper/test pair.

## Documentation

Updated:

- `docs/V4_RELEASE_NOTES.md`
- `docs/V4_BUILD_INTEGRATION_GUIDE.md`

The existing `docs/V4_UI_SPEC.md` remains the design contract; this batch implements its subscription mutation requirements. Checkout, payment method, price display and customer portal remain gated because they do not yet have complete backing contracts.

## Carried-forward P0 invariants

1. Google Drive PhotoX allocation remains default 2/3 of authoritative total quota, bounded by actual remaining bytes and safety reserve, with configurable per-account ratio; no fixed 10 GB cap.
2. Google Photos migration remains Picker-selected source media only, with append-only Google Photos or connected Google Drive destinations and durable migration state; no unrestricted full-library crawling claim.
3. Web continues to reuse the exact Desktop React UI/`DesktopBridge` semantics with authenticated HTTP/WebSocket adapters, Range media streaming, workspace/session security, CSRF/CORS/rate limiting/audit boundaries.

## Next priority

With authenticated billing mutations now backed end-to-end and exposed through the shared UI, the next safe product batch should wire Mobile's existing `/workspace` screen into the account/profile navigation, then continue member/invite lifecycle and tenant-ID/provider audit work. Billing checkout/payment/customer-portal work should remain separate until its domain/provider contracts exist.

## Verification gaps

- Live Stripe billing/webhook with a real Stripe account: NOT VERIFIED.
- Live Google Photos OAuth/migration with real accounts: NOT VERIFIED.
- Signed iOS IPA/Xcode release: NOT VERIFIED.
- Signed Android APK/AAB release: NOT VERIFIED.
