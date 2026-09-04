# V4 Run 036 — Billing Mutation Transport Contract

## Goal

Prepare the owner/admin billing mutation surface for safe Electron IPC and authenticated Web transport without exposing provider binding or creating UI controls before the transport is production-ready.

## Analysis

Existing V4 already had:

- durable `BillingMutationCoordinator` with hashed idempotency keys, request fingerprinting, retry/replay handling and authoritative subscription-state application;
- real Stripe mutation adapter for `change_plan`, `cancel_at_period_end` and `resume`;
- signed Stripe webhook ingestion;
- restart-safe period-end maintenance;
- periodic authoritative Stripe reconciliation.

The unsafe gap was the public request boundary. A browser/renderer contract must not be allowed to select `workspaceId`, billing provider or provider subscription ID because those values are authoritative server-side bindings.

## Implementation

Added `desktop/electron/billingMutationTransport.ts`.

Public request body is strict and permits only:

```ts
{
  operation: 'change_plan' | 'cancel_at_period_end' | 'resume';
  targetPlan?: 'free' | 'personal' | 'pro' | 'family' | 'team';
}
```

The idempotency key is supplied separately by transport (intended HTTP `Idempotency-Key` header / explicit IPC argument) and is validated at 16..200 characters.

The public contract rejects unknown fields, including attempts to provide:

- `workspaceId`;
- `provider`;
- `providerSubscriptionId`;
- body-level `idempotencyKey`.

`bindBillingMutationRequest()` then combines the validated public operation with a server-derived authoritative binding before handing the request to `BillingMutationCoordinator`.

A stable HTTP error status mapping was added for the upcoming Web Edge route:

- validation: 400;
- authorization/stale membership: 403;
- missing subscription: 404;
- idempotency conflict / mutation already in progress: 409;
- billing provider not configured: 503;
- upstream/provider mutation failure: 502.

## Regression coverage

Added `billingMutationTransport.test.ts` covering:

- valid change-plan request;
- authoritative server binding composition;
- rejection of client-supplied tenant/provider/subscription identity;
- strict operation/plan validation;
- idempotency header length validation;
- non-plain request bodies;
- stable HTTP status mapping.

## UI gate

No Change plan / Cancel / Resume buttons are enabled by this batch. `V4_UI_SPEC.md` remains authoritative: mutation controls must wait until both Electron IPC and Web HTTP transport are wired to the coordinator, with role, CSRF, idempotency replay and provider failure integration tests green.

## Next priority

1. Wire `DesktopWorkspaceAuth` to `BillingMutationCoordinator` + Stripe adapter using authoritative subscription binding.
2. Add Electron IPC/preload/shared `DesktopBridge` mutation method.
3. Add authenticated Web Edge `POST /api/web/v1/workspace/subscription/mutations` using CSRF plus `Idempotency-Key` header.
4. Add transport integration regression tests for owner/admin success, member/viewer denial, CSRF rejection, replay, mismatched tenant safety and provider failure.
5. Only then enable the shared Desktop/Web subscription mutation UI according to `V4_UI_SPEC.md`.

## P0 invariants carried forward

- Google Drive default PhotoX allocation remains 2/3 of authoritative total quota, bounded by provider remaining bytes and safety reserve, configurable per account; no fixed 10 GB cap.
- Google Photos migration source remains Picker-selected media only; destination is append-only Google Photos upload or connected Google Drive; no unrestricted full-library crawling claim.
- Web continues to reuse the same Desktop React UI/components/styles via `DesktopBridge`, with authenticated HTTP/WebSocket transport, Range streaming and workspace/session security boundaries.
