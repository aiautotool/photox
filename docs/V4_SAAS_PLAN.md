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

V4 must extend these instead of replacing them.

## 3. Audit: main SaaS gaps

### P0 gaps

1. **No first-class workspace/tenant boundary**
   - media, provider, device and session state are not consistently scoped by a workspace ID.
   - desktop currently behaves like the root trust boundary.

2. **No multi-user membership model**
   - no owner/admin/member/viewer lifecycle.
   - no invite/disable/leave/transfer ownership workflow.

3. **No central entitlement/quota enforcement**
   - no common policy for storage, ingress, device count, provider count, members, sharing or premium capabilities.

4. **Pairing is device-centric, not workspace-aware**
   - current access/refresh design is useful but pairing needs to bind a device to workspace + user + role.

5. **No durable SaaS control-plane persistence model**
   - workspace, memberships, subscriptions, usage counters and registered devices need durable schemas and migrations.

6. **No server-side billing boundary**
   - UI pricing must not be built before entitlement/subscription state is authoritative.

### P1 gaps

- no member/device management UX.
- no workspace switcher.
- no provider ownership/credential isolation per workspace.
- no public share token service with expiry/revocation.
- no centralized usage dashboard.
- no server-side activity/audit stream.
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

## 5. SaaS domain model introduced in Batch 1

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

### Phase B — durable workspace persistence

- add SQLite schema/migrations for workspace, membership, device, usage and subscription snapshots.
- scope media metadata and provider connections by workspace.
- add repository interfaces so desktop and future cloud control plane use the same contracts.

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

Desktop:

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
- [ ] Add durable workspace/membership/device/usage persistence and migrations.
- [ ] Add workspace-aware pairing credential implementation in Desktop.
- [ ] Persist workspace context on Mobile after pairing/login.
- [ ] Enforce media ingest quota before upload acceptance.
- [ ] Scope media/provider index operations by workspace.

### P1

- [ ] Workspace/plan/usage API.
- [ ] Mobile workspace/account + quota UI.
- [ ] Desktop workspace/node + quota UI.
- [ ] Device registry/revoke session UX.
- [ ] Member/invite lifecycle.
- [ ] Provider ownership per workspace.
- [ ] Public share service with expiry/password/revoke.
- [ ] Audit events and operations dashboard.
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
10. Every batch must run tests/typecheck/build before being marked complete.

## 10. Next Batch

1. Design SQLite workspace/membership/device/usage schema and repository APIs.
2. Add migration that creates a default personal workspace for legacy installs.
3. Bind Desktop pairing verifier to workspace + owner membership.
4. Store returned workspace identity in Mobile secure pairing/session state.
5. Add media-ingest entitlement check using actual incoming byte size.
6. Add tests proving one workspace cannot read/write another workspace when workspace scoping is present.
