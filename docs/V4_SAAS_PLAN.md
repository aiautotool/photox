# PhotoX V4 — SaaS Implementation Plan

## 1. Goal

V4 evolves the existing PhotoX desktop + mobile system into a SaaS-capable product without discarding the working V3 media pipeline.

V3 remains frozen. All SaaS migration work happens on `v4`.

The product model becomes:

`User -> Workspace -> Membership -> Devices -> Media Library -> Storage Providers -> Replicas`

A workspace is the isolation, quota, authorization and billing boundary. A desktop installation is a device/edge node of a workspace, not the owner of the whole product model.

## 2. Existing V3/V4 foundation to preserve

The current code already has strong reusable foundations:

- Expo React Native mobile client.
- Electron desktop node and receiver.
- QR/device pairing.
- access/refresh session abstractions and scoped media API.
- local/cloud media library merge.
- resumable-oriented sync ledger and upload progress.
- storage-provider abstractions with Local, Google Drive and Telegram implementations.
- replica policy/reconciliation packages.
- media delivery with Range streaming.
- video probe/thumbnail/transcoding pipeline.
- mobile persistent favorite/archive/trash/album state.
- real image editor, cloud download/delete, search, timeline, swipe/zoom viewer.
- browser-accessible Web edge using the exact Desktop React renderer with authenticated HTTP/WebSocket bridge.
- compliant Google Photos Picker migration with durable migration ledger.

V4 must extend these instead of replacing them.

## 3. Audit: main SaaS gaps

### P0 gaps

1. **Tenant boundary is not yet end-to-end**
   - workspace/member/device/usage persistence exists, and reusable media-cloud, Telegram, durable jobs and video/derived-media indexes are now workspace-scoped with cross-tenant tests.
   - remaining provider connection stores and future reusable indexes must preserve the same workspace-bound contract.
   - Web edge still uses an edge bootstrap identity instead of the final SaaS access/refresh session issuer.

2. **Multi-user lifecycle is incomplete**
   - owner/admin/member/viewer domain and durable membership storage exist.
   - invite/disable/leave/transfer ownership flows and UX remain.

3. **Entitlement/quota enforcement is not connected to every write path**
   - common role/feature/quota policy exists.
   - media ingest enforces byte quotas, while remaining provider/admin write paths still need uniform entitlement enforcement.

4. **Pairing v2 now exchanges into durable workspace sessions**
   - Desktop QR v2 carries workspace ID, workspace role, desktop device ID, short-lived challenge expiry and capabilities.
   - Mobile exchanges the challenge for a 15-minute JOSE access token plus durable refresh session, persists them in SecureStore, refreshes before expiry, and revokes on forget.
   - Desktop registers/refreshes the mobile WorkspaceDevice, enforces active membership/device state, and accepts bearer scopes on status/library/media/download/delete.
   - Relay preserves Authorization and workspace headers end-to-end; legacy v1 pair-code/pair-token compatibility remains temporarily available only for old clients.

5. **Control-plane persistence needs service wiring**
   - durable workspace, membership, device, usage and audit tables/repository exist.
   - subscription snapshots, SaaS API service wiring and event-driven usage counters remain.

6. **No authoritative billing boundary yet**
   - UI pricing must not be built before entitlement/subscription state is authoritative.

### P1 gaps

- no member/device management UX.
- no workspace switcher.
- no provider ownership/credential isolation per workspace for every provider store.
- no public share token service with expiry/revocation.
- no centralized usage dashboard.
- audit persistence exists but Web/Desktop mutations are not fully emitting audit events yet.
- no reliable cloud control-plane for multiple desktops per workspace.
- durable jobs are tenant-isolated, but no SaaS-grade job observability/dead-letter/retry dashboard yet.

### P2 gaps

- billing provider integration.
- team/family invitation email workflows.
- semantic search entitlement and indexing service.
- organization SSO/SCIM.
- regional data placement and enterprise retention policy.

## 4. Target architecture

### 4.1 Control plane

Authoritative SaaS entities:

- User
- Workspace
- WorkspaceMembership
- WorkspacePlan / Entitlements
- SubscriptionState
- WorkspaceUsage
- RegisteredDevice
- DeviceSession
- ProviderConnection metadata
- ShareLink
- AuditEvent

The control plane owns identity, membership, entitlements, quotas, device registration and routing metadata. It should not become the mandatory data path for full-resolution media when direct desktop/edge transfer is available.

### 4.2 Data plane

Existing desktop/media-provider architecture remains the data plane:

- originals may stay local, Google Drive, Telegram or other providers.
- desktop/edge nodes perform ingestion, FFmpeg processing, replica verification and repair.
- the control plane stores metadata needed to identify the workspace, device and policy, not necessarily every media byte.

### 4.3 Authorization

Every authenticated request should eventually have:

- `subject` (user/service identity)
- `workspaceId`
- `workspaceRole`
- `deviceId` when device-bound
- `sessionId`
- scopes

Authorization is two-stage:

1. API scope check (`media:read`, `media:write`, ...).
2. Workspace entitlement/role/quota check.

Legacy V3 pair-code sessions remain temporarily valid during migration. Pairing v2 exchanges its one-time workspace challenge for a scoped JOSE access token and SQLite-backed refresh session. Modern LAN/public/relay media requests carry Bearer authorization; Relay forwards it to the desktop receiver. V1 devices retain pair-code/pair-token fallback only for compatibility while upgraded clients use normal sessions.

Refresh-token persistence preserves workspace identity. Existing SQLite databases are migrated in place by adding nullable `workspace_id` and `workspace_role` columns so V3-era sessions remain readable during rollout.

## 5. SaaS domain and persistence

`@photosync/core` owns shared, platform-neutral policy types and logic:

- Workspace
- WorkspaceMembership
- WorkspaceDevice
- WorkspaceUsage
- WorkspaceEntitlements
- PlanCatalog
- WorkspaceAction
- authorization decision
- quota evaluation
- V3 personal-workspace migration helper

`@photox/persistence-sqlite` adds durable edge/control-plane compatible storage for:

- workspaces
- memberships
- registered devices
- workspace usage counters
- monthly ingress accounting period
- audit events
- workspace-aware refresh sessions
- workspace-scoped durable background jobs
- workspace-scoped media-cloud and video/derived-media metadata

Tenant-scoped repository tests use two workspaces with overlapping device/job/asset IDs and prove queries do not cross the workspace boundary. Monthly ingress migration is backward-safe: old rows with a NULL period keep their existing counter when first assigned to the current period; the ingress counter resets only when an already-established UTC month changes, while managed storage remains unchanged. Durable job and video-media migrations are also backward-safe: pre-workspace rows are adopted only by the designated legacy workspace and their SQLite identities become composite workspace keys.

No billing price is hard-coded into this domain. The default plan catalog is technical migration configuration and can be replaced by an authoritative catalog later.

## 6. Plan/entitlement strategy

Initial technical plan codes:

- free
- personal
- pro
- family
- team

Entitlements cover:

- managed storage bytes
- monthly ingress bytes
- members
- devices
- storage providers
- public share count
- target replica count
- public sharing
- remote access
- semantic search
- priority video processing

All feature UI must read the entitlement state. A disabled feature must be hidden/disabled with a real reason; it must not be a clickable mock control.

## 7. Migration strategy from V3

### Phase A — compatibility foundation

- Add workspace/role claims as optional access-session fields.
- Add shared entitlement engine.
- Create one default personal workspace for each legacy owner installation/account.
- Keep existing pairing and media APIs functional.
- Preserve workspace identity across refresh sessions while remaining backward-compatible with existing SQLite databases.

### Phase B — durable workspace persistence

- SQLite schema/repository for workspace, membership, device, usage and audit is implemented.
- legacy personal workspace bootstrap is implemented in Desktop startup, including desktop-device registration and existing-usage reconstruction.
- media ingest enforces workspace plan byte quotas before consuming the request body and rolls reservations back on failed ingest.
- monthly ingress is tracked by an authoritative UTC calendar-month period and rolls over without changing managed storage.
- media-cloud catalog, Telegram provider contracts, durable background jobs and video/derived-media metadata are workspace-scoped with backward-safe migration/tests.
- next: audit remaining provider connection stores and move into authoritative SaaS APIs/UX.
- repository interfaces remain platform-neutral so desktop edge and future cloud control plane can share contracts.

### Phase C — workspace-aware pairing

Implemented v2 session flow:

- Desktop tunnel QR carries workspace ID, workspace role, deterministic desktop device ID, challenge, challenge expiry and capability metadata.
- a shared in-process challenge manager is used by both the tunnel module and LAN/public receiver so the same v2 challenge is valid across transports.
- Relay preserves workspace ID and challenge end-to-end; Desktop validates the challenge before forwarding modern uploads into the receiver.
- Mobile parses/persists v2 workspace pairing context, immediately exchanges the short-lived challenge for access/refresh credentials, refreshes the access token before expiry, and sends Bearer authorization for modern LAN/public/relay operations.
- Desktop stores refresh sessions in SQLite, registers the mobile as a WorkspaceDevice, enforces membership/device revocation, and audits device registration/session pairing.
- Relay forwards Bearer authorization, workspace ID, media type and upload metadata to the Desktop receiver.
- expired/invalid challenges, expired/revoked sessions, revoked devices and workspace mismatches are rejected.
- v1 pairing remains compatible through legacy pair-code/pair-token fallback for migration only.

### Phase D — SaaS UX

Mobile:

- account/workspace selector.
- plan/usage screen.
- registered devices.
- members/invites when entitled.
- sync destination and remote-node status.

Desktop/Web shared renderer:

- signed-in workspace identity.
- node/device status.
- storage/provider quota dashboard.
- member/device administration according to role.
- activity/jobs/repair health.

### Phase E — control-plane service

Introduce a deployable service for:

- login/session federation.
- workspace/membership API.
- plan/subscription snapshots.
- device registration/routing.
- share-link issuance.
- audit event ingestion.

Media bytes should continue to use the most efficient available data-plane route.

### Phase B1 — legacy edge bootstrap and write quota enforcement (implemented)

Desktop creates the legacy personal workspace deterministically at startup, registers itself as a workspace device, and reconstructs managed storage/provider usage from existing state. Mobile sends the materialized file byte size before upload. Desktop reserves managed-storage and monthly-ingress bytes atomically before consuming the body, rejects over-quota writes, verifies the received byte count, rolls the reservation back on failed ingest, and records successful ingest in the workspace audit log. Media deletion releases managed storage but intentionally retains monthly ingress for the current accounting period. Google Drive connect/disconnect updates provider usage and durable audit state.

Monthly ingress now has a UTC `YYYY-MM` accounting period. A period transition resets only ingress bytes and preserves managed storage; migration from pre-period databases preserves the existing ingress counter on first assignment.

## 8. Delivery priorities

### P0 — current

- [x] Shared Workspace/Role/Plan/Quota/Entitlement domain.
- [x] Role + feature + quota decision engine.
- [x] Legacy personal workspace migration helper.
- [x] Add optional workspace identity to media API principal/session contracts.
- [x] Carry workspace context from pairing exchange through refresh sessions.
- [x] Encode workspace ID/role into JOSE access tokens.
- [x] Add durable workspace/membership/device/usage persistence and migrations.
- [x] Add durable workspace-scoped audit repository.
- [x] Preserve workspace ID/role in SQLite refresh sessions, including backward-safe schema upgrade.
- [x] Instantiate/migrate the default legacy workspace from Desktop startup and register the desktop device.
- [x] Add workspace-aware pairing v2 challenge implementation across Desktop LAN/public/Relay transports, preserving v1 compatibility.
- [x] Persist workspace pairing context on Mobile in SecureStore.
- [x] Enforce media ingest quota before upload acceptance using declared bytes, atomic SQLite reservation, size verification and rollback.
- [x] Keep workspace managed-storage/provider usage consistent on media delete and Google Drive connect/disconnect, with durable audit events.
- [x] Add backward-safe monthly ingress accounting period and UTC month rollover.
- [x] Exchange v2 pairing challenge for workspace-scoped JOSE access/refresh session, register the mobile device, refresh before expiry, enforce active device/membership state and revoke sessions on forget.
- [x] Workspace-scope reusable media-cloud catalog and Telegram provider contracts.
- [x] Workspace-scope durable background jobs in memory/SQLite with composite `(workspace_id, id)` identity and legacy adoption restricted to the designated legacy workspace.
- [x] Workspace-scope video/derived-media metadata in memory/SQLite with composite `(workspace_id, asset_id)` identity, including thumbnail/preview isolation and legacy adoption restricted to the designated legacy workspace.
- [ ] Audit remaining provider connection/index stores for global IDs and keep all new stores workspace-scoped.
- [ ] Replace Web edge bootstrap identity with authoritative SaaS access/refresh sessions.

### P1

- [ ] Workspace/plan/usage API.
- [ ] Mobile workspace/account + quota UI.
- [ ] Desktop/Web workspace/node + quota UI.
- [ ] Device registry/revoke session UX.
- [ ] Member/invite lifecycle.
- [ ] Provider ownership per workspace.
- [ ] Public share service with expiry/password/revoke.
- [ ] Wire audit events into Web/Desktop/provider/member/device mutations and operations dashboard.
- [ ] Persistent retry/dead-letter visibility.

### P2

- [ ] Billing provider adapter and webhook-driven subscription state.
- [ ] semantic search service/index lifecycle.
- [ ] team/family invite delivery.
- [ ] admin support tooling.
- [ ] enterprise SSO/SCIM and retention policies.

## 9. Engineering rules for V4

1. Never modify branch `v3`.
2. Existing working media behavior has priority over SaaS UI polish.
3. No mock SaaS controls. Build authoritative logic first.
4. Workspace isolation must be enforced server-side, never only in the client.
5. Subscription webhooks will eventually change entitlement state; clients do not decide their own paid plan.
6. Original media must never be deleted as a side effect of quota downgrade.
7. Quota downgrade blocks new writes/features but keeps read/export access unless an explicit policy says otherwise.
8. Every schema migration must be backward-safe and recoverable.
9. New auth/session fields remain optional until legacy V3-compatible migration completes.
10. Every code batch must run tests, typecheck, production build and repository CI before being marked complete.

## 10. Next Batch

1. Add device/session management APIs: list active workspace devices/sessions, revoke a device and invalidate all associated refresh sessions, with owner/admin role enforcement and audit events.
2. Add workspace/plan/usage APIs backed by authoritative workspace persistence/entitlements and surface them in the shared Desktop/Web renderer without mock controls.
3. Add Mobile workspace/account + quota/device UX using the same authoritative APIs/session model.
4. Audit remaining provider connection/index stores for global IDs and scope them before adding provider-management SaaS UX.
5. Extend durable audit emission to all administrative mutations and expose an operations/activity view.
6. Continue live Google Photos OAuth migration verification with real accounts; keep Picker-only source and append-only/Drive destinations.

## Run 17 — durable background-job tenant isolation

Completed:

- Added required `workspaceId` to `DurableJob` and bound `DurableJobQueue` execution, cancellation, pause/resume and checkpoint lookups to the caller workspace.
- Updated `MemoryJobRepository` to use workspace + job identity so identical job IDs can coexist across tenants.
- Migrated `SqliteJobRepository` to `(workspace_id, id)` primary identity with workspace-filtered get/list/upsert operations and fail-closed foreign-workspace writes.
- Added backward-safe SQLite migration for pre-workspace `photox_jobs`; old jobs are adopted only by the designated legacy workspace.
- Added tests for identical job IDs across workspaces, foreign mutation rejection, close/reopen isolation, legacy migration and queue cancellation isolation.
- Updated the SDK runtime persistence test to use the workspace-aware job contract.
- CI initially failed twice: first on unsafe `unknown` values passed to `node:sqlite`, then on an old SDK integration call-site that constructed an unscoped job repository. Both failures were fixed and the entire validation chain rerun.

## Run 18 — video/derived-media tenant isolation

Completed:

- Added required `workspaceId` to `VideoMediaRecord` and changed `VideoMediaRepository` get/remove operations to require workspace identity.
- Bound `VideoMediaService` to one workspace so probe/thumbnail/preview/transcode results cannot be persisted under another tenant.
- Updated `MemoryVideoMediaRepository` to use workspace + asset composite identity.
- Migrated `SqliteVideoMediaRepository` to `(workspace_id, asset_id)` primary identity with workspace-filtered reads/deletes and fail-closed foreign-workspace writes.
- Added backward-safe migration for old `photox_video_media` rows. Existing records without workspace identity are adopted only into the designated legacy workspace, while any already embedded workspace identity is preserved.
- Added persistence tests proving identical asset IDs can carry different thumbnail/preview metadata in two workspaces, survive SQLite close/reopen independently, delete independently, reject foreign writes, and prevent a non-legacy workspace from claiming old unscoped rows.
- Repository CI passed tests, full TypeScript typecheck and full production build with the new contract and migration enabled.

Still pending:

- authoritative device/session management API + UX;
- workspace/plan/usage API + shared Desktop/Web/Mobile UX;
- final audit of remaining provider connection/index stores;
- real-browser React UI/media smoke coverage;
- live Google OAuth migration verification with real accounts/consent;
- signed iOS/Android release verification;
- broader central SaaS control-plane extraction and operations UX.
