# PhotoX V4 — Run 41: Google Drive Allocation Policy Contract

## Goal
Close the remaining domain gap behind the approved Google Drive allocation settings UI without introducing a mock editor before persistence/transport exists.

## Implemented
- Kept the default PhotoX Drive allocation ratio at `2/3` of provider-authoritative total quota.
- Added per-account `safetyReserveBytes` to the core `StorageAccount` policy contract.
- Kept a backward-compatible default safety reserve of 100 MiB for legacy/unconfigured accounts.
- Added safe normalization: allocation ratio is clamped to `0..1`; reserve is clamped to a non-negative integer; non-finite input falls back to safe defaults.
- Added `storageAllocationSnapshot()` so transport/UI can consume one authoritative calculation containing provider total/free/used, PhotoX ratio-derived allocation limit, reserve, PhotoX app-used bytes, ratio remaining, provider remaining after reserve, and final writable bytes.
- `safeAvailable()` now delegates to that snapshot, so future per-account persisted reserve values automatically participate in Drive placement selection.
- Added regression coverage for the default 2/3 rule, default reserve, configurable ratio, configurable reserve, invalid input clamping and account selection.

## Intentionally not exposed yet
The existing Desktop Drive credential file does not yet persist allocation ratio/reserve and there is not yet an owner/admin mutation transport for these values. Therefore the approved ratio/reserve editing controls remain gated; no mock controls were added.

## Next integration batch
1. Persist `maxUsageRatio` and `safetyReserveBytes` on each workspace-owned saved Drive account without placing OAuth tokens in renderer-visible payloads.
2. Feed those settings into `RuntimeDriveAccount.storage` and return the safe allocation snapshot in `DriveAccountInfo`.
3. Add owner/admin Electron IPC + authenticated Web mutation/read routes with tenant checks, CSRF for Web mutation, validation and audit.
4. Extend shared `DesktopBridge` and only then enable the shared Desktop/Web Drive allocation editor from `V4_UI_SPEC.md`.
5. Add restart, tenant-isolation, permission and transport regressions.

## Preserved P0 contracts
- No fixed 10 GB PhotoX cap.
- Google Photos remains Picker-selected source media only.
- Desktop and Web remain on one shared React/DesktopBridge architecture.

## Verification
This batch is complete only when the final v4 HEAD passes repository tests, TypeScript typecheck and production build in CI. Live provider and signed mobile release verification remain separate.
