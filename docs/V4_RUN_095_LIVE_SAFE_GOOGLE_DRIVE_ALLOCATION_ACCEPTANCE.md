# V4 Run 095 — Live-safe Google Drive allocation acceptance harness

## Scope

This batch continues the Google Drive P0 without changing the already-correct allocation policy. PhotoX still derives each account allocation from the authoritative Google Drive total quota, defaults to a 2/3 ratio, honors a configurable per-account ratio and safety reserve, and caps effective writable bytes by the provider's actual remaining bytes.

## Implemented

- Added `LiveSafeDriveAllocationAcceptance`, whose provider contract exposes only an authoritative quota read. Upload, delete, folder creation, media writes and other provider mutation capabilities are deliberately absent.
- Added a durable atomic acceptance ledger containing only non-secret observations.
- Each verified observation records authoritative total/used/remaining bytes, ratio, reserve, PhotoX-managed bytes and independently recomputed allocation/effective writable bytes.
- Invalid or missing authoritative quota fails closed and cannot create a verified observation.
- Corrupt persisted state loads as no acceptance evidence; a new record is written only after a fresh verified observation.
- No OAuth access/refresh token, email, workspace identifier or media identifier is persisted in the acceptance ledger.

## Regression coverage

- 120 GiB total with the default ratio produces an 80 GiB PhotoX allocation and explicitly proves the result is above 10 GiB.
- A 90% per-account ratio with 4 GiB provider remaining and a 2 GiB reserve produces only 2 GiB effective writable capacity.
- The acceptance provider spy observes exactly one `about.storageQuota`-shaped read and no mutation capability.
- Malformed authoritative quota creates no accepted observation.
- Corrupt ledger state fails closed.

## Production integration status

The acceptance primitive and durable ledger are now production-shaped and regression covered. The next batch should wire it into the existing `runtimeDriveAccounts()` authoritative `getStorageQuota()` refresh path and surface the latest durable observation read-only through the existing shared Desktop/Web Drive allocation UI. That wiring should remain best-effort so acceptance telemetry can never make normal provider refresh or media backup fail.

## Carried-forward P0 requirements

1. Google Drive allocation has no fixed 10 GB cap. Default PhotoX allocation remains 2/3 of authoritative account total quota, additionally bounded by real remaining provider bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only, with append-only destination to Google Photos or connected Google Drive, durable ledger/progress/pause/resume/retry/verification/account selection and no unrestricted full-library crawling claims.
3. Web and Desktop continue to share the same React UI/components/styles through the shared `DesktopBridge`, with authenticated HTTP/WebSocket adapters and hardened public exposure.

## Still NOT VERIFIED

- Live connected Google Drive token/quota acceptance in a packaged Desktop app.
- Real Google Photos Picker migration between live accounts or to live Drive accounts.
- Physical iOS/Android resumable interruption/kill/restart acceptance.
- Signed iOS/Android and Windows/macOS release artifacts.
- Physical power-loss recovery, production reverse-proxy/TLS/WebSocket/Range deployment and Stripe live E2E.
