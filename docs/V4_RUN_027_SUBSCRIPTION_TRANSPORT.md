# V4 Run 27 — Authoritative subscription transport

## Completed

- Bound `WorkspaceSubscriptionService` into `DesktopWorkspaceAuth`.
- Added trusted Electron IPC `photosync:workspace-subscription` using the existing authoritative owner/admin actor boundary.
- Exposed the IPC through the preload bridge as `getWorkspaceSubscription()`.
- Extended the shared `DesktopBridge` type with `WorkspaceSubscriptionSnapshot` and the same read method for Desktop/Web adapters.
- Added the HTTP adapter mapping to `GET /api/web/v1/workspace/subscription` so the renderer contract is ready for the Web edge route.
- No billing mutation, checkout, upgrade, payment, or fake plan controls were added.

## Security / tenancy

- Subscription reads continue to use the authoritative `WorkspaceSubscriptionService.snapshot()` membership/role checks.
- The snapshot exposed to renderers contains no provider customer/subscription identifiers.
- `v3` remains unchanged.

## Remaining before UI is enabled

1. Add the authenticated Web edge `GET /api/web/v1/workspace/subscription` route and transport regression coverage.
2. Add renderer bridge regression coverage for the subscription endpoint.
3. Surface the read-only snapshot in the shared Desktop/Web workspace UI only after both transports are green.
4. Add provider-specific signed webhook adapter + idempotency and an explicit end-of-period entitlement transition before any billing mutation UI.
5. Continue Mobile workspace navigation and Mobile-safe device/session management.

## P0 requirements carried forward

- Google Drive allocation must remain authoritative-quota based: default PhotoX allocation = 2/3 of provider total quota, bounded by actual remaining provider bytes and safety reserve, with per-account ratio configuration; never restore a fixed 10 GB cap.
- Google Photos migration remains Picker-selected source only, with append-only Google Photos or connected Google Drive destinations, durable ledger/progress/pause/resume/retry/verification, and no unrestricted full-library crawling claims.
- Web remains the same React UI/components/styles as Desktop through the shared DesktopBridge contract, authenticated HTTP/WebSocket adapters, Range streaming, and workspace/session security controls.
