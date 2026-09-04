# PhotoX V4 — Run 47: Drive Runtime Policy Wiring

## Goal
Close the runtime gap left by Run 46 so persisted per-account Google Drive allocation policy affects real replica placement before any editor UI is enabled.

## Implemented
- `desktop/electron/main.ts` now loads Drive credential/account records through `loadWorkspaceDriveAccounts()` rather than maintaining a second legacy account-file parser.
- Runtime Drive accounts now call `driveRuntimeAllocation()` with the provider-authoritative `{limit, usage}` quota and PhotoX app-used bytes.
- The resulting `StorageAccount` carries the persisted `maxUsageRatio` and `safetyReserveBytes` into the existing `chooseAccount()` path used by cloud replica placement.
- Production default remains ratio `2/3` plus the configured/default safety reserve and actual provider remaining bytes. No fixed 10 GB cap was introduced.
- `RuntimeDriveAccount` keeps the allocation snapshot alongside the runtime storage account.
- `listDriveAccounts()` now uses `rendererDriveAccountInfo()` so Desktop/Web account listing can consume authoritative provider and PhotoX allocation fields without receiving OAuth tokens or workspace credential material.
- Token refresh/email persistence keeps the complete account record, including allocation policy fields, rather than dropping policy during credential refresh.

## Verification
The code commit passed the repository CI gate: unit/integration tests, TypeScript typecheck and production build were all successful before documentation finalization. Final HEAD must also pass the repository CI before this run is marked complete.

## Preserved P0 contracts
- Google Drive allocation: provider-authoritative quota, default `2/3`, actual provider remaining bytes, safety reserve, configurable per-account policy.
- Google Photos migration: current Picker-selected source media only; no unrestricted full-library crawling claim.
- Desktop/Web: same React component tree/styles with shared `DesktopBridge`, Electron IPC and authenticated Web adapter architecture.

## Remaining priority
The allocation editor is still intentionally gated. Next wire `DriveAllocationPolicyService` to owner/admin Electron IPC and authenticated Web GET/PATCH with server-derived tenant/account binding, Web CSRF and audit, expose it through `DesktopBridge`, test the transport/failure paths, then enable the shared Desktop/Web ratio + safety-reserve UI.

## NOT VERIFIED
- Live Google Drive allocation policy mutation with a real Google account.
- Live Google Photos OAuth/migration with real accounts.
- Live Stripe billing/webhook E2E.
- Signed iOS IPA/Xcode release.
- Signed Android APK/AAB release.
