# PhotoX V4 — Build & Integration Guide

> Branch: `v4` only. Do not apply these instructions to `v3`.

This is the canonical integration checklist for the SaaS-oriented V4 work. Update this file whenever a new subsystem changes build, runtime configuration, bridge/API contracts, persistence, security, or deployment.

## 1. Repository build gate

From the repository root:

```bash
npm install
npm test
npm run typecheck
npm run build
```

A V4 batch is not complete until all available commands above pass. Platform-specific signed builds that cannot run in the current environment must be reported as **NOT VERIFIED**, never PASS.

The monorepo contains Mobile, Desktop, Relay, core Google packages, and reusable `@photox/*` SDK/provider/persistence packages. Root scripts build SDK dependencies before impacted applications.

## 2. Desktop + Web shared UI architecture

Desktop and Web must use the same React component tree, styles, and `DesktopBridge` contract.

- Electron adapter: renderer -> preload -> Electron IPC -> authoritative Desktop/main-process service.
- Web adapter: browser -> authenticated HTTP/WebSocket -> Web Edge -> the same authoritative services.
- Do not put tenant authorization, quota calculation, billing authority, provider secrets, or destructive business rules in React.
- Do not add a visible control until its Electron/Web backing path exists and has tests.
- Preserve HTTP Range streaming for media/video delivery.

### Web runtime

Configure from `desktop/.env` based on `desktop/.env.example`:

```dotenv
PHOTOX_WEB_ENABLED=true
PHOTOX_WEB_HOST=127.0.0.1
PHOTOX_WEB_PORT=43118
PHOTOX_WEB_PUBLIC_BASE_URL=https://photos.example.com
PHOTOX_WEB_ALLOWED_ORIGINS=https://photos.example.com
PHOTOX_WEB_RATE_LIMIT=300
```

For public deployment, terminate TLS at a trusted reverse proxy and keep workspace/session auth, role checks, CORS, CSRF on browser mutations, rate limiting, audit, and WebSocket authentication enabled.

## 3. Workspace / tenant isolation

Every persistent or reusable domain record that can collide across customers must be scoped by `workspaceId`. Do not introduce a new global `assetId`, `jobId`, `deviceId`, provider account ID, session ID, or derived-media key without checking tenant ownership.

Current V4 work scopes media/cloud replica catalogs, Google Drive ownership, Telegram contracts, durable jobs, video/derived media, device/session state, workspace quota state, and subscription state. SQLite migrations for legacy global rows must adopt them only into an explicitly designated legacy workspace rather than making them visible to every workspace.

## 4. Google Drive allocation

Never restore the historical fixed 10 GB PhotoX cap.

Default account allocation is:

1. obtain the provider-authoritative Google account total quota;
2. apply the account allocation ratio, default `2/3`;
3. also respect actual remaining provider bytes;
4. subtract/retain the configured safety reserve;
5. use the smallest safe result as writable PhotoX capacity.

The ratio is configurable per Google Drive account. UI must distinguish provider total/free capacity from PhotoX allocated capacity.

## 5. Google Photos migration

Google Photos source selection must use the current Google Photos Picker API. Do **not** advertise or implement unrestricted full-library crawling.

Supported destination paths:

- selected Picker media -> another Google Photos account using append-only upload;
- selected Picker media -> a connected Google Drive account.

Integration must preserve the durable migration ledger, destination/source account selection, pause/resume/retry, progress, persisted transferred bytes, transfer-rate/ETA telemetry, resumable Drive checkpointing where supported, and verification state.

A migration UI control is valid only if its backing runner/state transition exists.

## 6. Workspace, devices, sessions, plans and quotas

The shared Desktop/Web workspace UI reads authoritative snapshots through `DesktopBridge` rather than calculating limits in React.

Workspace overview includes plan/status/role and technical quota dimensions for managed storage, monthly ingress, members, devices, providers, and public shares. Device/session management must preserve workspace ownership and owner/admin/member rules; refresh tokens and token hashes must never be rendered.

Mobile should consume the same authenticated workspace semantics. Do not create a second quota or role model specifically for Mobile.

## 7. Billing / Stripe integration

Billing is server/Electron-main only. Never expose Stripe secrets, webhook secrets, provider customer IDs, provider subscription IDs, or price mappings to renderer/Mobile.

Required environment variables:

```dotenv
PHOTOX_STRIPE_WEBHOOK_SECRET=whsec_replace_me
PHOTOX_STRIPE_SECRET_KEY=sk_live_replace_me
PHOTOX_STRIPE_PRICE_FREE=
PHOTOX_STRIPE_PRICE_PERSONAL=price_replace_personal
PHOTOX_STRIPE_PRICE_PRO=price_replace_pro
PHOTOX_STRIPE_PRICE_FAMILY=price_replace_family
PHOTOX_STRIPE_PRICE_TEAM=price_replace_team
PHOTOX_BILLING_RECONCILIATION_INTERVAL_MS=900000
PHOTOX_BILLING_PERIOD_END_TARGET_PLAN=free
```

Stripe webhook endpoint:

`POST /api/web/v1/billing/webhooks/stripe`

Webhook authentication is the Stripe raw-body signature, not browser Bearer/CSRF. Keep raw bytes intact for verification. Provider events pass through strict parsing, durable event idempotency, deterministic ordering, and authoritative subscription state application.

The control-plane also periodically reconciles Stripe state to heal missed/delayed webhooks. Period-end entitlement transitions are restart-safe and must not delete media/replicas.

Billing mutation primitives are being built behind a durable idempotent coordinator. Do not expose Change plan / Cancel / Resume / Payment controls until authenticated transport, provider mutation, reconciliation, role/CSRF/idempotency tests, and failure states are all wired.

## 8. Provider integration rules

- Local: workspace-owned paths/catalog entries.
- Google Drive: workspace-owned account configuration and quota-aware allocation.
- Telegram: account/media/secret keys are workspace-scoped; raw bot token remains in secret storage and must never enter renderer/Web/audit payloads.
- New providers must implement tenant ownership, health/capacity reporting, retry classification, and replica bookkeeping before UI exposure.

## 9. Production validation checklist

Before calling a batch complete:

- run repository unit/integration tests;
- run TypeScript typecheck;
- run production build for impacted apps and root repository build;
- run/verify repository CI on the final HEAD;
- fix failures and rerun until green;
- verify `v3` SHA is unchanged;
- commit/push only to `v4`;
- update this guide if integration/build/config changed;
- update `V4_RELEASE_NOTES.md` for user/developer-visible changes;
- update `V4_UI_SPEC.md` when a new user-facing capability needs screens/components/states.

## 10. Currently NOT VERIFIED in automated CI

Unless a later run explicitly verifies them, report these accurately:

- live Google Photos OAuth/migration with real accounts;
- live Stripe billing/webhook E2E with a real Stripe account;
- signed iOS IPA/Xcode release build;
- signed Android APK/AAB release build.
