# V4 Run 098 — Google Photos migration acceptance diagnostics

## Goal

Add a production-safe, read-only acceptance layer around the durable Google Photos migration ledger so PhotoX can distinguish migrations that preserve current Google Photos API constraints from jobs whose provenance or durable progress is incomplete.

## Implemented

- Added `googlePhotosMigrationAcceptance()` in the Desktop Electron runtime layer.
- Acceptance is workspace-scoped and fails closed on cross-workspace job access.
- Source mode is explicitly represented as `picker_selected_only`; the acceptance contract does not represent or advertise unrestricted Google Photos library crawling.
- Google Photos destinations are represented as `append_only_google_photos`; Drive destinations are represented as `google_drive`.
- Acceptance requires a durable Picker session id on the migration job.
- Durable job totals are cross-checked against durable migration items.
- Completed items require a durable destination `targetId`, preserving restart-safe verification semantics and preventing an upload-only state from being reported as verified.
- Google Photos source and destination accounts must differ.
- Added regression coverage for Picker-selected Google Photos destination, Google Drive destination, missing Picker provenance, missing destination verification, durable progress mismatch, workspace isolation, and same-account rejection.
- Added the new regression files to `desktop/tsconfig.electron-test.json` so repository CI executes them.

## Priority requirements carried forward

1. Google Drive allocation remains based on authoritative provider total quota with a default PhotoX ratio of 2/3, bounded by actual remaining provider bytes and safety reserve, with per-account configurable ratio. No fixed 10 GB PhotoX cap is permitted.
2. Google Photos migration remains Picker-selected only and append-only for Google Photos destinations, with durable migration ledger/progress/pause-resume-retry/verification/account selection. PhotoX must never advertise unrestricted full-library crawling.
3. Desktop and Web continue to share React UI/components/styles and the `DesktopBridge` contract with Electron IPC and authenticated HTTP/WebSocket adapters.

## Remaining gap

The new acceptance diagnostics are not yet projected into the shared Desktop/Web migration UI. Live Google Photos Picker acceptance with real accounts is also NOT VERIFIED in this environment.

The prior Drive acceptance production integration gap also remains: `DriveAllocationAcceptanceRuntime` still needs to be instantiated in the production Drive refresh path and projected read-only through the shared account model without allowing acceptance telemetry failures to affect backup availability.

## Next batch

1. Expose Google Photos migration acceptance status through the shared Desktop/Web migration view using the existing durable ledger; no mock controls.
2. Wire the Drive allocation acceptance runtime into the production quota refresh path when a safe full-file edit path is available, keeping telemetry best-effort and non-blocking.
3. Add live-safe provider acceptance observations around real Google Photos Picker session materialization without broad-library enumeration.
