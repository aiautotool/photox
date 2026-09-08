# V4 Run 097 — Drive allocation acceptance production runtime

## Goal

Continue Run 096 without changing the working Google Drive allocation formula. Add a production-shaped composition boundary that owns the durable, non-secret acceptance ledger and can be invoked immediately after the authoritative Google Drive quota refresh path.

## Implemented

- Added `DriveAllocationAcceptanceRuntime` under Desktop Electron.
- The runtime owns the durable `drive-allocation-acceptance.json` ledger inside PhotoX state storage.
- `observeBestEffort()` accepts only an already-authoritative quota snapshot, account policy and PhotoX app-used bytes, then delegates to the read-only live-safe acceptance verifier from Runs 095–096.
- Acceptance failures remain telemetry-only and do not throw into quota refresh or backup callers.
- `latestStatus()` returns a non-secret read-only projection suitable for the shared Desktop/Web bridge/UI. It never projects OAuth tokens, refresh tokens, email addresses, workspace IDs or media identity.
- Regression coverage locks the default 2/3 policy to an 80 GiB allocation on a 120 GiB account and explicitly proves the result exceeds the removed legacy 10 GiB cap.
- Regression coverage also proves custom 90% allocation is still bounded by actual provider remaining bytes minus a 2 GiB safety reserve.

## Current integration boundary

The runtime composition is now ready to be instantiated once from Desktop `stateDir()` and invoked after `about.storageQuota` plus PhotoX app-used bytes are read in `runtimeDriveAccounts()`. The GitHub connector available in this automation can create and replace complete files but cannot apply a surgical patch to the very large `desktop/electron/main.ts`; therefore this run deliberately did not risk reconstructing that file from truncated API payloads. No mock UI/control was added.

## P0 requirements carried forward

1. Google Drive allocation remains dynamic: default 2/3 of authoritative total storage, bounded by real remaining provider bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only, with append-only Google Photos or Google Drive destinations, durable ledger/progress/pause/resume/retry/verification, and no unrestricted library-crawling claim.
3. Desktop and Web continue sharing React components/styles through `DesktopBridge`, with authenticated HTTP/WebSocket adapters and public-edge security controls.

## Next batch

Wire `DriveAllocationAcceptanceRuntime` into `runtimeDriveAccounts()` and project `latestStatus()` through `listDriveAccounts()` to the existing shared Drive allocation UI. Acceptance telemetry failure must leave the account usable for backup and render only `not verified`. Then proceed to Google Photos Picker live-safe migration acceptance.
