# PhotoX V4 — Run 21: Device/session transport

## Completed

This run continues the authoritative device/session management work from Runs 19–20 without changing the underlying tenant/role model.

- Added authenticated Web APIs for active workspace devices and refresh sessions:
  - `GET /api/web/v1/devices`
  - `GET /api/web/v1/sessions`
  - `DELETE /api/web/v1/sessions/:sessionId`
  - `DELETE /api/web/v1/devices/:deviceId`
- Web mutation routes retain the existing CSRF requirement; authorization, workspace isolation, owner/admin restrictions, owner protection and durable audit behavior continue to be enforced by `DeviceSessionManagementService` rather than duplicated in the renderer.
- Connected the Web edge routes to the active `DesktopWorkspaceAuth` instance so production requests use the same authoritative session/device service used by pairing and token validation.
- Registered Electron IPC handlers after workspace auth initialization for the same operations. Desktop invokes them through a trusted actor resolved from the active owner membership, not a hard-coded client role.
- Extended preload and the shared `DesktopBridge` contract with `listWorkspaceDevices`, `listWorkspaceSessions`, `revokeWorkspaceSession` and `revokeWorkspaceDevice`.
- Added the matching authenticated HTTP adapter implementations so Desktop and Web use one renderer-facing contract.
- Added Web edge integration coverage for device/session listing, CSRF rejection on revoke, and successful revoke transport.
- Added renderer bridge regression coverage proving the exact HTTP mappings, bearer propagation and CSRF header on DELETE operations.
- Existing one-time ticket, access refresh, WebSocket reconnect, migration, Range streaming and provider behavior remain intact.

## Validation

The code batch passed the repository CI chain:

- dependency install: PASS
- unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS

Signed iOS/Android packages and live Google OAuth migration are outside this CI environment and remain **NOT VERIFIED**.

## Status carried forward

The following product constraints remain mandatory:

1. Google Drive PhotoX allocation has no fixed 10 GiB cap. Default managed allocation is 2/3 of Google's authoritative total quota, with per-account ratio override, while actual provider free bytes and safety reserve still bound writable capacity.
2. Google Photos migration remains Picker-only for source selection. PhotoX must not advertise unrestricted full-library crawling. Destinations remain append-only Google Photos or connected Google Drive with durable ledger/resume/retry/verification.
3. Web continues to use the exact shared Desktop React renderer and `DesktopBridge`, with authenticated HTTP/WebSocket transport, Range streaming, workspace/session authorization, role enforcement, CORS, CSRF, rate limiting and audit controls.

## Next prioritized batch

1. Build the real shared Desktop/Web **Thiết bị** management UI on top of these now-working bridge methods: list active devices, show last-seen/platform/user, show sessions for owner/admin, revoke a session, revoke a device, refresh after mutation, and display real permission/error states. Do not create controls without backing logic.
2. Add authoritative workspace/plan/usage API and shared Desktop/Web quota UI using the existing workspace persistence and entitlement engine.
3. Add Mobile workspace/account + quota/device UX using the same session and workspace APIs.
4. Continue audit of remaining provider connection/index stores for global identifiers and keep all new persistence workspace-scoped.
5. Expand administrative audit/activity and durable background-job retry/dead-letter visibility.
6. Add live Google Photos migration verification harness for real OAuth accounts outside normal CI while preserving the Picker-only source model.
