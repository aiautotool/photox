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
   - workspace/member/device/usage persistence now exists, but legacy media/provider indexes are not consistently workspace-scoped yet.
   - Web edge still uses an edge bootstrap identity instead of the final SaaS access/refresh session issuer.

2. **Multi-user lifecycle is incomplete**
   - owner/admin/member/viewer domain and durable membership storage exist.
   - invite/disable/leave/transfer ownership flows and UX remain.

3. **Entitlement/quota enforcement is not connected to every write path**
   - common role/feature/quota policy exists.
   - media ingest still needs authoritative usage lookup and byte reservation before accepting writes.

4. **Pairing remains device-centric**
   - access/refresh contracts can carry workspace identity and SQLite refresh sessions now preserve it.
   - Desktop QR/pairing challenge and Mobile secure state still need workspace binding.

5. **Control-plane persistence needs service wiring**
   - durable workspace, membership, device, usage and audit tables/repository now exist.
   - subscription snapshots, SaaS API service wiring and event-driven usage counters remain.

6. **No authoritative billing boundary yet**
   - UI pricing must not be built before entitlement/subscription state is authoritative.

### P1 gaps

- no member/device management UX.
- no workspace switcher.
- no provider ownership/credential isolation per workspace.
- no public share token service with expiry/revocation.
- no centralized usage dashboard.
- audit persistence exists but Web/Desktop mutations are not fully emitting audit events yet.
- no reliable cloud control-plane for multiple desktops per workspace.
- no SaaS-grade job observability/dead-letter/retry dashboard.

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

Legacy V3 pair-code sessions remain temporarily valid during migration, with workspace fields optional until all clients have upgraded.

Refresh-token persistence must preserve workspace identity. Existing SQLite databases are migrated in place by adding nullable `workspace_id` and `workspace_role` columns so V3-era sessions remain readable during rollout.

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

`@photox/persistence-sqlite` now adds durable edge/control-plane compatible storage for:

- workspaces
- memberships
- registered devices
- workspace usage counters
- audit events
- workspace-aware refresh sessions

Tenant-scoped repository tests use two workspaces with overlapping device IDs and prove queries do not cross the workspace boundary.

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
- next: create/default the legacy personal workspace from Desktop startup and control-plane bootstrap.
- next: scope media metadata and provider connections by workspace.
- repository interfaces remain platform-neutral so desktop edge and future cloud control plane can share contracts.

### Phase C — workspace-aware pairing

Desktop pairing QR should resolve to:

- workspace ID
- desktop device/node ID
- one-time pairing challenge
- capability/version metadata

Mobile pairing exchange should produce a workspace-scoped device session. Pair codes should become short-lived challenges, not long-lived authorization secrets.

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
- [ ] Instantiate/migrate the default legacy workspace from Desktop startup.
- [ ] Add workspace-aware pairing credential implementation in Desktop.
- [ ] Persist workspace context on Mobile after pairing/login.
- [ ] Enforce media ingest quota before upload acceptance.
- [ ] Scope media/provider index operations by workspace.
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

1. Instantiate `SqliteWorkspaceRepository` in Desktop startup and create/migrate the legacy personal workspace deterministically.
2. Put workspace ID + desktop device ID + short-lived challenge/capability metadata into the pairing flow.
3. Persist returned workspace identity and session material in Mobile SecureStore.
4. Add authoritative WorkspaceUsage byte reservation/check before `/api/v1/media` accepts a write; roll back reservations on failed ingest.
5. Add `workspace_id` to media/provider catalog rows with safe migration and prove cross-workspace reads/writes are rejected.
6. Replace static Web edge bootstrap role/workspace configuration with verified SaaS access tokens and emit durable audit events for mutations.
