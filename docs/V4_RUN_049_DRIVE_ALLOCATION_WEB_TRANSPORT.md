# PhotoX V4 — Run 49: Drive Allocation Web Transport Boundary

## Goal
Continue from Run 48 without repeating the completed Electron IPC work. Add the Web-specific application transport boundary required before exposing Drive allocation mutation through the shared Desktop/Web UI.

## Implemented
- Added `driveAllocationWebTransport.ts` as the Web-facing adapter around the existing `DriveAllocationPolicyService`.
- Web principals are converted into Drive allocation actors using only server-authoritative `subject`, `workspaceId`, `workspaceRole` and `deviceId`; tenant or role identity is never accepted from the mutation body.
- Missing role information fails closed to `viewer`.
- List/update results expose only renderer-safe Drive account projections already established by the runtime allocation layer.
- Validation, role and account-not-found failures preserve stable `400/403/404` status semantics.
- Unexpected internal/provider errors are redacted to `DRIVE_ALLOCATION_INTERNAL_ERROR` so OAuth/provider details are not leaked to browser clients.
- Added regression coverage for principal derivation, list/update delegation, role denial, tenant/account miss, validation errors and secret redaction.
- Added the new Web transport and tests to the Electron TypeScript test compilation gate.

## Preserved P0 contracts
- Google Drive allocation remains default 2/3 of provider-authoritative total quota, bounded by actual provider remaining bytes and per-account safety reserve.
- Per-account ratio and safety reserve remain workspace-scoped persisted policy and already affect production account selection.
- No fixed 10 GB cap was introduced.
- Google Photos migration remains Picker-selected only, with append-only Google Photos destination semantics.
- Desktop/Web continue to share one React component/style tree and one `DesktopBridge` contract.

## Remaining before Drive allocation editor enablement
1. Register authenticated Web GET/PATCH route plumbing in `PhotoXWebEdgeServer` using this adapter.
2. Require browser CSRF on PATCH, keep owner/admin enforcement, CORS/rate limit and audit at the Web edge.
3. Bind the live Web edge in `main.ts` to the same Drive policy service/listing used by Desktop.
4. Extend shared `DesktopBridge`/HTTP adapter with `updateGoogleDriveAllocation(accountId, input)` while preserving the existing Electron preload implementation.
5. Add Web edge + bridge regressions, then enable the shared Desktop/Web ratio + safety-reserve editor only after those gates are green.

## Verification gate
This batch is complete only when the final v4 HEAD repository CI passes tests, TypeScript typecheck and production build. Live provider E2E and signed mobile release artifacts remain NOT VERIFIED unless explicitly run.
