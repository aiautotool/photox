# PhotoX V4 — Release Notes

This file is a cumulative release/development note for branch `v4`. It should be updated for every meaningful user-facing or integration-facing batch.

## V4 SaaS foundation — current state

### Storage and replication
- Google Drive PhotoX allocation no longer assumes a fixed 10 GB cap.
- Default allocation is 2/3 of the provider-authoritative account total quota, constrained by real remaining provider bytes and a safety reserve.
- Allocation ratio can be configured per account.
- Media-cloud replica catalog and provider/account statistics are workspace isolated.
- Local, Google Drive and Telegram provider work is structured around workspace ownership and replica policy.

### Google Photos migration
- Source flow is designed around the current Google Photos Picker API and selected media only.
- PhotoX does not claim unrestricted Google Photos full-library crawling.
- Selected photos/videos can migrate to another Google Photos account using append-only upload or to a connected Google Drive account.
- Migration state includes durable ledger/progress, pause/resume/retry, verification, account selection, resumable transfer support where available, persisted byte progress, transfer rate and ETA.

### Desktop + Web
- Web edition reuses the Desktop React UI/components/styles through a shared `DesktopBridge` contract.
- Electron uses IPC; Web uses authenticated HTTP/WebSocket adapters.
- Web exposure supports configurable host/port/public base URL/allowed origins and reverse-proxy deployment.
- Media delivery preserves Range requests for streaming.
- Public Web access includes workspace/session auth, role enforcement, CORS/CSRF where applicable, rate limiting and audit boundaries.
- Web reconnect logic refreshes credentials and retries transient refresh/network failures with bounded backoff.

### Tenant isolation and reliability
- Workspace scoping has been added across media/cloud replica records, Google Drive ownership, Telegram contracts, durable jobs, video/derived-media persistence, device/session state and subscription state.
- Legacy SQLite migrations adopt unscoped rows into a designated legacy workspace instead of exposing them cross-tenant.
- Durable background jobs, reconciliation and migration state are designed for restart/retry behavior.

### Devices, sessions and workspace UX
- Authoritative workspace device/session service supports list/revoke behavior with role and tenant checks.
- Desktop IPC and Web HTTP expose the same device/session operations through `DesktopBridge`.
- Shared Desktop/Web UI shows registered devices and permitted sessions with real loading/error/permission states.
- Workspace dashboard shows authoritative plan, role, status, quotas and entitlement availability.
- Mobile has an authenticated workspace/quota/device screen using the same workspace/session semantics.

### Plans, quotas and subscription control-plane
- Workspace overview exposes managed storage, monthly ingress, members, devices, storage providers and public-share quota dimensions.
- Subscription snapshots support legacy/unmanaged and billing-managed lifecycle states without exposing provider identifiers to renderer code.
- Shared Desktop/Web UI surfaces subscription state read-only; fake payment/change-plan controls are intentionally absent.
- Stripe webhook ingress verifies the signature against raw request bytes, validates supported events/plans and feeds the durable subscription event ledger.
- Subscription events have replay/idempotency protection and deterministic same-timestamp ordering.
- Restart-safe period-end entitlement maintenance is implemented.
- Stripe authoritative reconciliation periodically heals missed/delayed webhook delivery.
- A durable billing mutation coordinator exists for change-plan/cancel-at-period-end/resume primitives; provider mutation transport/UI remains gated until the complete security/test path is ready.

## Security notes
- Renderer/Mobile must never receive Google/Telegram/Stripe provider secrets.
- Refresh token values and token hashes are not renderer-facing device/session fields.
- Tenant-sensitive persistent identities must include workspace ownership.
- Browser destructive mutations require authenticated authorization and CSRF where applicable.
- Stripe webhook ingress uses provider signature authentication rather than browser session authentication.

## Build / verification policy
Every V4 code batch must run repository tests, TypeScript typecheck, impacted production builds and repository CI. A platform build that cannot run because signing/tooling is unavailable is reported as **NOT VERIFIED**, not PASS.

See `V4_BUILD_INTEGRATION_GUIDE.md` for current setup and integration requirements and `V4_UI_SPEC.md` for the UI implementation contract.

## Known verification gaps
- Live Google Photos OAuth/migration with real accounts: NOT VERIFIED.
- Live Stripe billing/webhook E2E with a real Stripe account: NOT VERIFIED.
- Signed iOS IPA/Xcode release: NOT VERIFIED.
- Signed Android APK/AAB release: NOT VERIFIED.
