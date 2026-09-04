# PhotoX V4 — Release Notes

This file is a cumulative release/development note for branch `v4`. It should be updated for every meaningful user-facing or integration-facing batch.

## V4 SaaS foundation — current state

### Storage and replication
- Google Drive PhotoX allocation no longer assumes a fixed 10 GB cap.
- Default allocation is 2/3 of the provider-authoritative account total quota, constrained by real remaining provider bytes and a safety reserve.
- Allocation ratio can be configured per account.
- The core allocation contract now also supports a per-account safety reserve. The default remains 100 MB for legacy/unconfigured accounts, while invalid ratio/reserve inputs are clamped safely and the allocation snapshot exposes authoritative total/free/used, ratio-derived limit, reserve and actually available PhotoX bytes for future transport/UI use.
- Desktop now has a workspace-scoped Drive allocation policy persistence layer. Per-account `maxUsageRatio` and `safetyReserveBytes` survive restart, writes preserve OAuth credential payloads without exposing them, legacy unscoped credential files are adopted only into the configured legacy workspace, and cross-workspace mutation fails closed.
- A strict Drive allocation mutation transport parser now accepts only `maxUsageRatio` and `safetyReserveBytes`; client-supplied workspace/account binding fields are rejected, ratio must stay within 0..1, reserve must be a non-negative safe integer, empty patches fail closed, and stable HTTP error mapping is defined for the upcoming IPC/Web transport wiring.
- A dedicated Drive runtime-allocation adapter now combines a persisted workspace-owned account policy with authoritative provider quota counters and PhotoX app-used bytes to produce the exact `StorageAccount` consumed by account selection plus a renderer-safe allocation snapshot. This adapter carries the persisted ratio/reserve into the allocation algorithm and has regression coverage for the default 2/3 policy, custom reserve/ratio, malformed quota counters and secret-free renderer output. Main-process account loading still needs to call this adapter before the allocation editor can be enabled.
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
- Workspace, Subscription and Google Photos Migration surfaces now use the approved light card-based visual system from the V4 design reference: larger readable hierarchy, clearer quota/progress presentation, consistent blue primary actions and responsive layouts. Existing authoritative mutation/migration logic is preserved; no mock controls were introduced.

### Tenant isolation and reliability
- Workspace scoping has been added across media/cloud replica records, Google Drive ownership, Telegram contracts, durable jobs, video/derived media, device/session state and subscription state.
- Legacy SQLite migrations adopt unscoped rows into a designated legacy workspace instead of exposing them cross-tenant.
- Durable background jobs, reconciliation and migration state are designed for restart/retry behavior.

### Devices, sessions and workspace UX
- Authoritative workspace device/session service supports list/revoke behavior with role and tenant checks.
- Desktop IPC and Web HTTP expose the same device/session operations through `DesktopBridge`.
- Shared Desktop/Web UI shows registered devices and permitted sessions with real loading/error/permission states.
- Workspace dashboard shows authoritative plan, role, status, quotas and entitlement availability.
- Mobile has an authenticated workspace/quota/device screen using the same workspace/session semantics.
- Mobile home now exposes a real `Workspace & dung lượng` navigation shortcut that opens the authenticated `/workspace` screen instead of leaving that route discoverable only by direct navigation.

### Plans, quotas and subscription control-plane
- Workspace overview exposes managed storage, monthly ingress, members, devices, storage providers and public-share quota dimensions.
- Subscription snapshots support legacy/unmanaged and billing-managed lifecycle states without exposing provider identifiers to renderer code.
- Stripe webhook ingress verifies the signature against raw request bytes, validates supported events/plans and feeds the durable subscription event ledger.
- Subscription events have replay/idempotency protection and deterministic same-timestamp ordering.
- Restart-safe period-end entitlement maintenance is implemented.
- Stripe authoritative reconciliation periodically heals missed/delayed webhook delivery.
- A durable billing mutation coordinator exists for change-plan/cancel-at-period-end/resume primitives.
- The public billing mutation transport contract is strict: clients may supply only `operation` plus an optional `targetPlan`, while the idempotency key comes from transport metadata and workspace/provider/subscription binding is derived server-side.
- Desktop Electron IPC/preload and the shared `DesktopBridge` expose that same mutation contract without exposing Stripe or subscription provider identifiers.
- Web exposes `POST /api/web/v1/workspace/subscription/mutations`; it requires authenticated owner/admin context, browser CSRF, and an `Idempotency-Key` header. CORS explicitly permits that header.
- Web billing mutation failures use defined validation/authorization/conflict/provider status mapping rather than falling through to generic authentication errors.
- Shared Desktop/Web Subscription UI now exposes real Change plan, Cancel at period end and Resume controls only when authoritative role/lifecycle state permits them.
- Billing UI does not optimistically mutate local plan state: after success it refreshes the authoritative workspace/subscription snapshot.
- A failed UI mutation retains the same request fingerprint/idempotency key for an explicit retry, while changing the requested mutation generates a new idempotency identity.
- Member/viewer and unmanaged workspaces receive a permission/state explanation instead of fake disabled billing controls.
- Checkout, payment-method and customer-portal controls remain intentionally absent because their backing contracts are not implemented yet.

## Security notes
- Renderer/Mobile must never receive Google/Telegram/Stripe provider secrets.
- Refresh token values and token hashes are not renderer-facing device/session fields.
- Tenant-sensitive persistent identities must include workspace ownership.
- Browser destructive mutations require authenticated authorization and CSRF where applicable.
- Stripe webhook ingress uses provider signature authentication rather than browser session authentication.
- Billing mutation clients never choose authoritative workspace/provider/subscription binding; those values come from the active server-side subscription row.
- Billing idempotency keys are transport inputs and durable storage keeps only their SHA-256 digest, not the raw key.
- Google Drive allocation policy persistence must preserve OAuth tokens server-side; renderer/Web policy payloads must never contain token material.
- Drive allocation mutation payloads may not choose workspace/account identity; those bindings must come from the authenticated route/IPC target.

## Build / verification policy
Every V4 code batch must run repository tests, TypeScript typecheck, impacted production builds and repository CI. A platform build that cannot run because signing/tooling is unavailable is reported as **NOT VERIFIED**, never PASS.

See `V4_BUILD_INTEGRATION_GUIDE.md` for current setup and integration requirements and `V4_UI_SPEC.md` for the UI implementation contract.

## Known verification gaps
- Live Google Photos OAuth/migration with real accounts: NOT VERIFIED.
- Live Stripe billing/webhook E2E with a real Stripe account: NOT VERIFIED.
- Live Google Drive allocation policy mutation with a real account: NOT VERIFIED.
- Signed iOS IPA/Xcode release: NOT VERIFIED.
- Signed Android APK/AAB release: NOT VERIFIED.
