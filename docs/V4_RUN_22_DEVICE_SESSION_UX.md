# PhotoX V4 — Run 22: Shared device/session management UX

## Scope

This run continues directly from Run 21. The authoritative workspace device/session service and its Web HTTP + Electron IPC `DesktopBridge` transports already existed, so this run adds the real shared Desktop/Web renderer UX instead of duplicating server authorization or adding mock controls.

## Completed

- Added a shared `DevicesPage` React component used by the same Desktop/Web renderer tree.
- Replaced the old `Thiết bị` summary that inferred a `1/0` device count from tunnel state with authoritative `listWorkspaceDevices()` data.
- Added active workspace device cards with device name, kind, platform, user ID, device ID, last-seen time and active-session count.
- Added the owner/admin session view using `listWorkspaceSessions()` without exposing refresh tokens or token hashes.
- Added real session logout through `revokeWorkspaceSession(sessionId)` and real device revocation through `revokeWorkspaceDevice(deviceId)`.
- Device revocation confirmation explicitly communicates that all associated refresh sessions will be invalidated by the authoritative backend service.
- Session-list authorization failures are isolated from device registry loading so lower-privilege users can still see the device state allowed by the server while the UI reports that session metadata is unavailable.
- Added loading, empty, permission/error and mutation-busy states; mutation errors are surfaced instead of pretending success.
- Preserved the existing pairing QR and edge connectivity panel alongside authoritative device registry information.
- Added responsive styling for Desktop and Web without creating a separate Web UI.

## Security/architecture properties preserved

- React does not decide workspace role or tenant ownership.
- Web mutations continue through authenticated `DesktopBridge` HTTP calls and therefore retain Bearer verification and CSRF requirements.
- Electron continues through the IPC bridge into the same authoritative workspace auth/service layer.
- Owner/admin/member protections and cross-tenant fail-closed behavior remain server-side.
- No refresh token, token hash, provider secret or reusable credential is rendered.

## Validation

The code batch passed repository CI run 493:

- dependency install: PASS
- repository tests: PASS
- full TypeScript typecheck: PASS
- full production build: PASS

The final documentation commit must also pass repository CI before this run is marked complete.

## Priority requirements carried forward

1. Google Drive allocation remains default `2/3` of authoritative account total quota, constrained by actual provider remaining bytes and safety reserve, with configurable per-account ratio. No fixed 10 GiB PhotoX cap may be reintroduced.
2. Google Photos migration remains compliant Picker-selected source only, with append-only Google Photos destination or connected Google Drive destination, durable progress/retry/verification, and no unrestricted full-library crawling claim.
3. Web remains the exact shared Desktop React UI/components/styles through `DesktopBridge`, with authenticated HTTP/WebSocket adapters, Range media streaming and public-edge security controls.

## Next prioritized batch

1. Add authoritative workspace/plan/usage APIs backed by existing workspace persistence and entitlement policy.
2. Surface workspace identity, plan and quota/usage in the shared Desktop/Web renderer using those real APIs.
3. Add the corresponding Mobile workspace/quota/device UX using the same workspace session model.
4. Audit remaining provider connection/index stores for global IDs before expanding provider-management SaaS UX.
5. Continue member/invite lifecycle, operations/audit view and central control-plane extraction.
6. Keep live Google OAuth migration and signed mobile release validation explicitly NOT VERIFIED until credentials/signing environments are available.
