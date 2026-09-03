# PhotoX V4 Run 20 — tenant-safe session revocation hardening

## Analysis

Run 19 added authoritative workspace device/session management, but the existing Web self/admin revoke path ultimately called `DesktopWorkspaceAuth.revoke(sessionId)` by session ID alone. Before exposing device/session management through more Desktop/Web APIs, V4 must prove that a caller cannot revoke a refresh session belonging to another workspace.

## Completed

- Added workspace-scoped individual refresh-session revocation to `DeviceSessionManagementService`.
- A session lookup now requires `(workspace_id, session_id)` and returns `SESSION_NOT_FOUND` for foreign-workspace IDs.
- Active membership is required for every individual session revocation.
- A user may revoke their own session; revoking another user's session requires owner/admin role.
- An admin cannot revoke an owner's session.
- Successful managed session revocation appends durable `session.revoke` audit metadata without exposing refresh tokens or token hashes.
- Hardened `DesktopWorkspaceAuth.revoke(sessionId)` so even the legacy/current Web revoke handler fails closed unless the target refresh session belongs to the auth service's bound workspace.
- Added cross-tenant regression coverage proving workspace A cannot revoke workspace B's session and proving admin-to-owner protection.
- Existing device-wide revocation remains workspace-scoped and continues to invalidate all refresh sessions bound to the revoked device.

## Validation

Repository CI run 480 passed:

- `npm install`
- `npm test`
- full TypeScript typecheck
- full production build

## Current priority requirements preserved

- Google Drive PhotoX allocation remains based on the authoritative Google account quota, defaulting to 2/3 per account while respecting actual provider free bytes, safety reserve, and configurable per-account ratio. No fixed 10 GB cap is reintroduced.
- Google Photos migration remains Picker-selected source media only, with append-only Google Photos destination or connected Google Drive destination. PhotoX does not claim unrestricted full-library crawling.
- Web remains the same Desktop React renderer behind the shared `DesktopBridge` architecture with authenticated HTTP/WebSocket transport, workspace/session auth, role enforcement, CORS/CSRF/rate limiting/audit, and Range media streaming.

## Remaining risks / next batch

1. Expose the authoritative device/session service through authenticated Web HTTP handlers and Electron IPC/DesktopBridge APIs, preserving the same workspace/role boundary.
2. Add shared Desktop/Web device management UX only after those real APIs exist; no mock controls.
3. Add authoritative workspace/plan/usage APIs and shared quota UI, then Mobile workspace/device/quota UX.
4. Continue auditing provider connection/index stores for global identities.
5. Add a live Google OAuth migration verification harness outside CI; real-account OAuth migration remains NOT VERIFIED until credentials/consent are available.
6. Signed iOS IPA/Xcode and signed Android APK/AAB release builds remain NOT VERIFIED in this environment.
