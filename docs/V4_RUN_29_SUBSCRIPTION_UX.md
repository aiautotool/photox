# PhotoX V4 Run 29 — Authoritative subscription UX

## Completed in this batch

- Continued from the existing V4 subscription control-plane and transport work; no billing flow was reimplemented.
- Added read-only subscription status to the shared Desktop/Web `DevicesPage`, so Electron and Web render the same React component and styles.
- Subscription data comes only from `DesktopBridge.getWorkspaceSubscription()` and therefore uses the existing Electron IPC or authenticated Web HTTP adapter.
- The UI surfaces the authoritative plan, source (`legacy` or billing-managed), lifecycle status, current billing period, cancel-at-period-end flag, and last update time.
- Owner/admin authorization remains server-side. A denied subscription read is isolated to a permission notice and does not break workspace quota/device rendering.
- No upgrade, payment, cancel, resume, or change-plan control was added because provider webhook verification, idempotency, and end-of-period entitlement transitions are not production-ready yet.

## P0 requirements carried forward

1. Google Drive allocation must remain quota-authoritative: default PhotoX allocation is 2/3 of the provider-reported total account quota, configurable per account, and always bounded by actual remaining provider bytes and the configured safety reserve. Never restore a fixed 10 GB cap.
2. Google Photos migration must remain Picker-selected source only. Destination is append-only Google Photos upload or a connected Google Drive account, with durable ledger/progress/pause/resume/retry/verification/account selection. Never advertise unrestricted full-library crawling.
3. Web must continue using the same Desktop React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session auth, role enforcement, CORS/CSRF/rate-limit/audit protections as applicable.

## Next prioritized batch

1. Add a provider-specific billing webhook ingress abstraction with signature verification before accepting provider events.
2. Add durable event idempotency/replay protection and explicit end-of-period entitlement transition scheduling.
3. Only after those are authoritative, expose mutation controls such as change-plan/cancel/resume/payment actions.
4. Connect the existing Mobile workspace screen into normal account/device navigation and continue member/invite lifecycle plus provider-identifier tenant-isolation audit.

## Verification expectations

Repository CI must remain green for unit/integration tests, TypeScript typecheck, and production build. Signed iOS/Android release builds and live Google Photos OAuth migration remain NOT VERIFIED until executed in environments with the required signing credentials/accounts.
