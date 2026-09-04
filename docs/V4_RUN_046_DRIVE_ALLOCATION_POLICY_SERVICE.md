# PhotoX V4 — Run 46: Drive Allocation Policy Service

## Goal
Continue the Google Drive allocation work without enabling UI controls before their backing mutation path exists. The production policy remains provider-authoritative quota, default PhotoX allocation ratio `2/3`, actual provider remaining bytes, and per-account safety reserve.

## Implemented
- Added `DriveAllocationPolicyService` as the authoritative application-service boundary for Drive allocation reads and mutations.
- List operations remain workspace-scoped and return renderer-safe Drive account projections supplied by the runtime account layer.
- Mutation is restricted to owner/admin roles before persistence.
- Client payload is parsed through the existing strict transport contract, so only `maxUsageRatio` and `safetyReserveBytes` are accepted; client-supplied workspace/account binding fields remain forbidden.
- Mutation persists through `driveAccountPolicyStore`, preserving OAuth credential material server-side.
- Cross-workspace account mutation fails closed with `DRIVE_ACCOUNT_NOT_FOUND`.
- Successful mutation emits a safe audit event containing only the resulting ratio/reserve and actor/target identifiers, never Google tokens.
- Successful mutation re-reads the account projection and returns the refreshed authoritative account state rather than optimistic client state.

## Regression coverage
- Workspace-scoped listing.
- Owner mutation of ratio and reserve.
- Persistence while preserving refresh-token material.
- Partial update preserving production defaults for untouched policy fields.
- Member/viewer mutation denial.
- Cross-workspace account denial.
- Rejection of client-supplied workspace binding fields.

The service and its regression tests are included in `desktop/tsconfig.electron-test.json`, so repository tests/typecheck/build exercise the new boundary.

## Preserved P0 contracts
- No fixed 10 GB Google Drive cap.
- Google Photos source remains current Picker-selected media only; no unrestricted full-library crawling claim.
- Desktop/Web continue to share React UI/components/styles and the `DesktopBridge` architecture.

## Remaining blocker before allocation editor UI
`desktop/electron/main.ts` still directly constructs runtime `StorageAccount` values. The next batch must wire `driveRuntimeAllocation()` and `rendererDriveAccountInfo()` into `runtimeDriveAccounts()` / `listDriveAccounts()`, then connect this service to owner/admin Electron IPC and authenticated Web GET/PATCH routes with tenant binding, CSRF and audit. Only after that path is green should the shared Desktop/Web ratio + safety-reserve editor be enabled.

## Verification
Repository CI must be green on the final HEAD for tests, TypeScript typecheck and production build before this batch is marked complete.

Still NOT VERIFIED unless a later run explicitly proves otherwise: live Google Drive policy mutation with a real account, live Google Photos OAuth/migration, live Stripe E2E, signed iOS release, signed Android release.
