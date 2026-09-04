# PhotoX V4 — UI / UX Implementation Spec

> Purpose: canonical visual/interaction contract for new V4 capabilities. Code should follow this document and reuse the same Desktop/Web React components. Do not create mock buttons: every enabled action must have backing logic.

## 1. Design language

PhotoX should feel like a modern private photo cloud rather than an admin database.

- Desktop/Web: left navigation + large content canvas; compact utility header; responsive cards and tables.
- Mobile: native-feeling stacked navigation, bottom tabs/sheets where appropriate, large media-first surfaces.
- Reuse existing typography, spacing, radii, icons, buttons, dialogs and status tokens before adding variants.
- Primary information first; IDs and diagnostics are secondary/copyable metadata.
- Destructive actions always use confirmation and show the actual scope of impact.
- Loading uses skeleton/progress state; errors remain actionable; empty states explain the next real action.
- Permission denial is not rendered as an empty list.
- Desktop and Web must not fork their visual component tree.

## 2. Navigation model

Recommended Desktop/Web navigation:

1. Photos
2. Albums
3. Search
4. Migration
5. Storage
6. Devices
7. Workspace
8. Sharing
9. Activity / Operations
10. Settings

Mobile keeps media-first bottom navigation and exposes Workspace/Devices/Storage through the account/profile area until usage justifies a dedicated tab.

## 3. Workspace dashboard

### Header
- Workspace avatar/mark
- Workspace name
- Current plan badge
- Workspace status badge
- Current member role
- Refresh action

### Quota overview
Use a responsive 2–3 column card grid.

Each finite quota card contains:
- metric label;
- current / limit;
- remaining value;
- progress bar;
- percent;
- helper text.

Metrics:
- Managed storage
- Monthly ingress
- Members
- Devices
- Storage providers
- Public shares

Threshold presentation:
- `<75%`: normal
- `75–89%`: warning
- `>=90%`: critical
- unlimited: show `Unlimited`, no fake percentage bar

### Capabilities
Compact entitlement chips/list:
- Remote access
- Public sharing
- Semantic search
- Priority video processing
- Target original replica count

Do not render generic Upgrade/Checkout actions until price/checkout contracts are production-ready.

## 4. Subscription card

The shared Desktop/Web Subscription card is now backed for lifecycle mutations. It must continue to use only authoritative subscription/workspace data.

Show:
- Plan
- Source: PhotoX-managed / billing-managed
- Status: unmanaged, trialing, active, past due, paused, canceled, incomplete
- Current period dates when available
- Cancel-at-period-end notice
- Last synchronized timestamp

Status behavior:
- `active`: positive/neutral
- `trialing`: informational + trial end if available
- `past_due`: warning, explain that billing needs attention without claiming data deletion
- `paused`: warning
- `canceled`: explain current entitlement/period-end state accurately
- `incomplete`: warning/error
- `unmanaged`: explain that the workspace has no authoritative billing connection

Implemented backed actions for owner/admin billing workspaces:
- Change plan (`personal`, `pro`, `family`, `team`)
- Cancel at period end
- Resume subscription when cancel-at-period-end is active

Mutation UI requirements:
- only render actions allowed by authoritative role/lifecycle state;
- require confirmation for lifecycle-changing actions;
- show an in-progress state and disable concurrent billing mutation controls;
- never optimistically rewrite plan/status;
- after success refresh authoritative workspace/subscription state;
- distinguish replayed success from a newly applied mutation when useful;
- preserve the same caller idempotency key for explicit retry of the exact failed mutation fingerprint;
- generate a new idempotency identity for a different payload;
- show safe provider errors without leaking provider bindings/secrets.

Still future/gated until backing contracts exist:
- Checkout
- Payment methods
- Billing/customer portal
- Price/currency presentation

## 5. Devices and sessions

### Device list
Card/table row:
- device icon/type
- friendly device name
- platform
- user
- last seen
- active session count
- status
- overflow actions

Owner/admin permitted action:
- Revoke device

Confirmation dialog must state that active refresh sessions for that device will be revoked. Never imply that local/cloud media is deleted.

### Session list
Owner/admin-only section when permitted:
- user
- device
- created/last activity/expiry if available
- session status
- Revoke session

Never show refresh token or token hash.

## 6. Storage providers

### Provider overview
Top summary:
- healthy/degraded/offline account counts
- total PhotoX allocated capacity
- used PhotoX allocation
- replica health

### Google Drive account card
Show separately:
- Google account identity
- Provider authoritative total quota
- Provider used/free
- PhotoX allocation ratio, default `66.67%`
- Calculated PhotoX allocation
- Safety reserve
- PhotoX used/remaining
- health / last quota refresh

Account settings:
- allocation ratio control
- safety reserve control where supported
- reconnect/remove actions with confirmation

Never display a fixed `10 GB` PhotoX cap unless the provider account itself actually produces that authoritative capacity.

### Telegram provider card
- account label
- connection health
- media count/replica count
- last successful operation
- reconnect/remove

Never render bot token.

## 7. Google Photos migration

This screen must explicitly say that source media is selected through Google Photos Picker; do not use language such as “scan entire Google Photos library”.

### Step 1 — Source
- Google Photos source account
- Connect/reconnect state
- `Select photos & videos` action launching the supported Picker flow
- selected item count/size after Picker returns

### Step 2 — Destination
Segmented destination choice:
- Google Photos account
- Google Drive account

Destination account selector only lists connected/eligible accounts.

### Step 3 — Review
- source account
- selected count/size
- destination
- append-only explanation for Google Photos destination
- estimated transfer information when available
- Start migration

### Active migration job
- job status
- item count completed/failed/remaining
- bytes transferred
- transfer rate
- ETA
- progress bar
- current item
- Pause / Resume / Retry failed / Cancel only when corresponding backing state transition exists

### Verification/results
- verified count
- failed count
- retryable/non-retryable errors
- destination link/action when a safe destination reference exists
- durable history of migration jobs

## 8. Web access settings

Settings -> Web access:
- enabled toggle
- bind host
- port
- public base URL/domain
- allowed origins
- reverse-proxy/TLS guidance
- current local/public status
- authenticated session status

Security status panel:
- workspace auth
- WebSocket auth
- CSRF protection
- rate limiting
- audit logging

Do not expose signing secrets or raw session credentials.

## 9. Replica health / media durability

For a media details panel:
- desired replica count
- actual healthy replica count
- provider locations
- verification state
- last integrity check
- repair/retry action when backing job exists

Global storage dashboard:
- healthy
- under-replicated
- repairing
- failed/unavailable

This should read like cloud durability, not raw provider bookkeeping.

## 10. Mobile Workspace screen

Account/profile sheet should contain a visible `Workspace & storage` entry opening the existing workspace screen.

Mobile screen sections:
1. workspace identity + plan/role
2. storage/monthly ingress summary
3. remaining quotas
4. capabilities
5. registered devices
6. provider/storage shortcut

Keep destructive session/device administration hidden until Mobile has a dedicated secure mutation contract. Do not reuse browser-CSRF assumptions blindly.

## 11. Operations / audit screen

Owner/admin only.

Filters:
- time range
- actor
- action category
- resource type
- status

Rows:
- timestamp
- actor
- action
- resource
- outcome
- safe metadata

Never show provider credentials, refresh-token hashes, webhook secrets or Stripe customer/subscription IDs if those identifiers are intentionally server-only.

## 12. Required states for every new screen

Every feature UI must define and implement:
- loading
- loaded
- empty
- permission denied
- recoverable error + retry
- non-recoverable error
- offline/degraded where relevant
- mutation in progress
- mutation success refreshed from authoritative state
- mutation failure without optimistic false success

## 13. UI implementation gate

Before a new V4 UI feature is considered complete:

1. backing domain/service logic exists;
2. Desktop IPC and/or authenticated Web route exists as required;
3. shared `DesktopBridge` contract exists;
4. role + tenant isolation is server-side;
5. React uses real data, not placeholders presented as functional controls;
6. responsive Desktop/Web state is implemented;
7. Mobile uses the same domain semantics when applicable;
8. unit/integration tests cover transport and failure paths;
9. typecheck/build/CI are green;
10. release notes and build/integration guide are updated.
