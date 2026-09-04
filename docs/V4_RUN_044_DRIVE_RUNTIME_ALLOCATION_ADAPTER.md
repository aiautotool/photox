# PhotoX V4 — Run 44: Drive Runtime Allocation Adapter

## Goal
Continue the Google Drive allocation production path without enabling a mock editor. Bind the persisted account policy shape to authoritative provider quota data in a small, testable main-process adapter before changing the large Electron runtime surface.

## Implemented
- Added `desktop/electron/driveRuntimeAllocation.ts`.
- The adapter combines a workspace-owned saved Drive account, provider-authoritative quota counters and PhotoX app-used bytes into the exact `StorageAccount` shape used by `chooseAccount()`.
- Persisted `maxUsageRatio` and `safetyReserveBytes` are carried into the runtime storage object through `driveAllocationPolicyOf()`.
- The same adapter produces the core `storageAllocationSnapshot()` and a renderer-safe snapshot containing no OAuth tokens, workspace binding or account credential material.
- Malformed/negative provider counters normalize fail-closed to zero writable capacity.
- Added regression coverage for default 2/3 allocation, custom ratio/reserve, provider-free/reserve bounding and safe renderer output.
- Added the regression to `tsconfig.electron-test.json` so repository CI executes it.

## Preserved contracts
- No fixed 10 GB cap.
- Default PhotoX allocation remains 2/3 of authoritative provider total quota.
- Final writable capacity remains bounded by ratio remaining, actual provider free bytes and safety reserve.
- Google Photos migration remains Picker-selected only.
- Desktop and Web remain one shared React UI through `DesktopBridge`.

## Remaining gap
`desktop/electron/main.ts` still constructs `RuntimeDriveAccount.storage` directly. The next batch must replace that construction with `driveRuntimeAllocation()`, expose its safe snapshot through `DriveAccountInfo`, then add authenticated owner/admin IPC/Web mutation before enabling the ratio/reserve editor.

## Verification gate
This batch is complete only after final-HEAD CI passes tests, TypeScript typecheck and production build. Signed iOS/Android releases and live provider E2E remain NOT VERIFIED unless explicitly run.
