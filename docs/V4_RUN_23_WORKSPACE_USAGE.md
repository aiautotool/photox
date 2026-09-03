# PhotoX V4 — Run 23: authoritative workspace / plan / usage API

## Completed

- Added `WorkspaceOverviewService` on the Desktop edge as the authoritative read model for workspace identity, active membership, technical plan entitlements and current usage.
- Workspace overview is tenant-bound: the caller must have an active membership in the requested workspace and a stale/mismatched role is rejected.
- Monthly ingress usage is rolled over through the existing authoritative UTC accounting-period logic before a snapshot is returned.
- Active member/device counts are reconciled from durable membership/device rows before they are exposed, instead of blindly trusting cached counters after disable/revoke operations.
- Quota dimensions expose `current`, `limit`, `remaining` and `percent` for managed storage, monthly ingress, members, devices, storage providers and public shares.
- No billing price, payment status or fake subscription state was introduced. The snapshot uses the existing technical entitlement catalog until an authoritative subscription snapshot service is wired.
- Added Electron IPC `photosync:workspace-overview` and exposed it through the preload bridge.
- Added authenticated Web endpoint `GET /api/web/v1/workspace`; it uses the verified Web principal and the same tenant-bound service used by Desktop.
- Added `getWorkspaceOverview()` to the shared `DesktopBridge`, with Electron IPC and authenticated HTTP adapters.
- Added service, Web transport and renderer bridge regression coverage, including cross-tenant rejection, stale-role rejection and UTC monthly-ingress rollover.

## Preserved requirements

- Google Drive allocation remains based on each account's authoritative total quota with default PhotoX ratio `2/3`, provider remaining bytes and safety reserve; no fixed 10 GiB cap is reintroduced.
- Google Photos migration remains Picker-only for source selection and supports append-only Google Photos or connected Google Drive destinations; unrestricted full-library crawling is not implemented or advertised.
- Web continues to reuse the Desktop React renderer and shared `DesktopBridge`, with authenticated HTTP/WebSocket access, CSRF protection for mutations and workspace-bound media streaming.

## Next prioritized batch

1. Build the shared Desktop/Web workspace + quota page on top of `getWorkspaceOverview()` with no mock controls, including storage/monthly ingress/member/device/provider/share utilization and plan capability visibility.
2. Surface the same authoritative workspace/quota/device state in Mobile using the existing workspace session model.
3. Introduce authoritative subscription snapshots/control-plane wiring before any billing/pricing UI.
4. Complete the audit of remaining provider connection stores and ensure every provider credential/index is workspace-owned.
5. Continue member/invite lifecycle and operations/audit visibility.

## Environment verification still pending

- Real Google OAuth migration with live accounts/consent: **NOT VERIFIED**.
- Signed iOS IPA/Xcode release build: **NOT VERIFIED**.
- Signed Android APK/AAB release build: **NOT VERIFIED**.
