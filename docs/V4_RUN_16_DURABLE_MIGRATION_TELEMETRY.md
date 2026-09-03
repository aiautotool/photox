# PhotoX V4 — Run 16: durable migration telemetry

## Completed

- Promoted migration throughput and ETA from renderer-only estimation into the durable Google Photos migration job model.
- Added optional `transferRateBps` and `etaSeconds` job fields so Desktop/Web snapshots can retain the latest authoritative estimate across renderer reloads and process reconnects.
- `GooglePhotosMigrationRunner` now derives throughput from observed byte deltas with smoothing and persists job-level transferred bytes, rate and ETA while a transfer is running.
- Multi-item accounting uses per-item reported-byte deltas and a monotonic observed total so advancing to a later item cannot make aggregate progress move backwards or stall telemetry.
- Pause/cancel clear live rate/ETA; terminal completion clears live rate and records ETA `0`.
- SQLite migration is backward-safe: existing `photox_migration_jobs` tables gain nullable `transfer_rate_bps` and `eta_seconds` columns only when missing.
- Added close/reopen persistence coverage proving rate and ETA survive process restart.

## Validation

The code batch is accepted only after repository `npm test`, full TypeScript typecheck and full production build pass in the standard v4 CI workflow.

## Current priority carry-forward

1. Keep Google Drive allocation based on the default 2/3 authoritative provider quota, actual remaining provider bytes, safety reserve and per-account ratio override; never restore a fixed 10 GB cap.
2. Keep Google Photos migration compliant with Picker-selected source media only, append-only Google Photos destination or connected Google Drive destination, durable ledger/resume/retry/verification, and never advertise unrestricted library crawling.
3. Keep Desktop/Web renderer parity through the shared `DesktopBridge`, authenticated HTTP/WebSocket Web adapter, Range streaming, workspace sessions, roles, CORS/CSRF/rate-limit/audit and reverse-proxy support.
4. Next SaaS P0/P1 work: workspace-scope remaining media/provider indexes, then authoritative workspace/plan/usage and device/session management APIs plus shared Desktop/Web/Mobile UX.
5. Remaining verification: real-browser React/media smoke test and live real-Google-account OAuth migration harness.

## NOT VERIFIED

- Live Google Photos migration with real OAuth accounts/consent.
- Signed iOS IPA/Xcode release build.
- Signed Android APK/AAB release build.
