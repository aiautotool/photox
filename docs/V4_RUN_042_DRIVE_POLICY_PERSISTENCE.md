# PhotoX V4 — Run 42: Google Drive Allocation Policy Persistence

## Goal
Continue the Drive allocation work from Run 41 by adding durable workspace-scoped persistence for per-account allocation ratio and safety reserve before exposing any editor control.

## Implemented
- Added `desktop/electron/driveAccountPolicyStore.ts` as the credential-side policy persistence boundary.
- Persisted `maxUsageRatio` and `safetyReserveBytes` alongside the server-side saved Drive account record while preserving OAuth token material unchanged.
- Kept safe defaults aligned with core: ratio `2/3`, reserve `100 MiB`.
- Policy normalization clamps ratio to `0..1` and reserve to a non-negative integer.
- Writes use an atomic temporary-file + rename path and mode `0600` for the temporary credential file.
- Legacy unscoped account files are adopted only into the configured legacy workspace.
- Cross-workspace policy mutation fails closed with `DRIVE_ACCOUNT_NOT_FOUND` instead of resolving another tenant's account.
- Added restart/persistence, token-preservation, legacy-adoption, input-normalization and tenant-isolation tests.
- Added the new regression files to the Electron test TypeScript project.

## Intentionally still gated
The shared Desktop/Web allocation editor remains disabled because the runtime/account read path and owner/admin mutation transport are not yet wired to this store. No mock control was added.

## Next batch
1. Replace the inline saved-account policy handling in Desktop main with this persistence boundary.
2. Feed persisted ratio/reserve into `RuntimeDriveAccount.storage`.
3. Add allocation snapshot fields to renderer-safe `DriveAccountInfo` without token material.
4. Add owner/admin Electron IPC and Web GET/PATCH routes with tenant checks, Web CSRF, validation and audit.
5. Extend `DesktopBridge` and then enable the shared Drive allocation editor according to `V4_UI_SPEC.md`.

## Preserved P0 contracts
- No fixed 10 GB cap; default PhotoX allocation remains `2/3` of authoritative Google account total quota and remains bounded by provider remaining bytes and safety reserve.
- Google Photos migration remains Picker-selected only and append-only for a Google Photos destination.
- Desktop/Web remain on the same React UI and DesktopBridge architecture.

## Verification gate
This batch is complete only after the final v4 HEAD passes repository tests, TypeScript typecheck and production build in CI. Live provider and signed mobile release verification remain separate NOT VERIFIED items.
