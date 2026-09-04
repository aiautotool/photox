# PhotoX V4 — Run 48: Drive Allocation Desktop Transport

## Goal
Continue the Google Drive allocation P0 without enabling a renderer control before a real mutation path exists.

## Implemented
- Added `driveAllocationDesktopTransport.ts` as a dedicated trusted-desktop transport boundary.
- Registered Electron IPC `photosync:google-drive-allocation-update` from the V4 Electron entrypoint.
- The IPC derives the workspace/user/role from the authoritative workspace database instead of accepting tenant or role identity from renderer input.
- Mutation delegates to the existing `DriveAllocationPolicyService`, so strict payload parsing, owner/admin enforcement, workspace-scoped persistence and audit recording are preserved.
- The transport opens the existing workspace SQLite database only for the duration of a mutation and closes it afterward.
- Renderer preload now exposes `updateGoogleDriveAllocation(accountId, input)` but no UI control is enabled yet.
- Added the new transport to the Electron test TypeScript compilation gate.

## Preserved P0 contracts
- Default Drive allocation remains 2/3 of provider-authoritative total quota.
- Runtime allocation continues to be bounded by real provider remaining bytes and safety reserve.
- Per-account ratio and safety reserve remain persisted workspace-scoped policy.
- No fixed 10 GB cap was introduced.
- Google Photos migration remains Picker-selected only and append-only for Google Photos destinations.
- Desktop/Web continue to share one React UI tree; no duplicate Web UI was introduced.

## Remaining before UI enablement
1. Add authenticated Web PATCH for Drive allocation policy using the same service, with server-derived principal, CSRF, role enforcement and audit.
2. Add the mutation to the shared `DesktopBridge` contract and Web HTTP adapter.
3. Add transport regressions for Electron/Web failure and tenant paths.
4. Only after those gates are green, enable the shared Desktop/Web allocation-ratio and safety-reserve editor.

## Verification gate
The batch is complete only if final-HEAD repository tests, TypeScript typecheck and production build succeed in repository CI. Platform-signed mobile artifacts and live provider E2E remain separately NOT VERIFIED unless explicitly run.
