# V4 Run 080 — Whole-file compatibility telemetry contract

## Scope

This run continued from V4 Run 079 and implemented the executable telemetry/deprecation-readiness contract required before the legacy `POST /api/v1/media` whole-file compatibility receiver can ever be retired or restricted.

## Analysis

The legacy whole-file route is intentionally still available because physical Android/iOS network-loss → process-kill → restart resumable acceptance remains NOT VERIFIED. Removing the route before measuring real compatibility use would risk breaking deployed clients.

The safe next step is therefore a fail-closed telemetry/readiness contract. It must distinguish bearer whole-file, pair-code, and pairing-challenge use without retaining secrets or media/request identity. Retirement must remain blocked unless physical-device resumable acceptance is explicitly confirmed, a minimum observation window has elapsed, and zero whole-file compatibility traffic was observed.

## Implementation

- Added `desktop/electron/legacyWholeFileCompatibilityTelemetry.ts`.
- Added coarse counters for `bearer`, `pair-code`, and `pairing-challenge` auth modes.
- Added coarse outcomes for `accepted`, `duplicate`, and `rejected` requests.
- Snapshot output contains only counts and timestamps. The contract deliberately never stores bearer tokens, pair credentials/challenges, workspace IDs, device IDs, filenames, media keys, IP addresses, or request headers.
- Added fail-closed `deprecationReadiness()`:
  - blocks when physical-device resumable acceptance is not confirmed;
  - blocks until the configured observation window completes (default seven days);
  - blocks when any compatibility request is observed;
  - reports ready only when all three conditions are satisfied.
- Added unit regressions covering all auth modes/outcomes and each readiness blocker.

## Validation

Code HEAD `0c66223339f87362e568f67424883b1451a7c479` passed repository CI run 1002 / `34164368522`:

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux directory package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED because the execution environment cannot resolve `github.com`; GitHub Actions is the executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation remains authoritative-quota based, with no fixed 10 GB cap: default PhotoX allocation is 2/3 of provider total quota, bounded by actual provider remaining bytes and safety reserve, with per-account configurable ratio.
2. Google Photos migration remains compliant: Google Photos Picker-selected source only, durable migration ledger/progress/pause/resume/retry/verification/account selection, append-only Google Photos destination or connected Google Drive destination, and no unrestricted full-library crawling claim.
3. Web and Desktop continue to share the exact React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session authorization, roles, and public-edge security controls.

## Remaining risks / NOT VERIFIED

- The telemetry contract is tested but is not yet wired into the production `receiveMedia()` path or operator diagnostics, so live counters are not collected yet.
- Physical Android/iOS network-loss → process kill → restart → byte-offset resumable acceptance.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live Google Drive account acceptance and failure/recovery scenarios.
- Live Google Photos Picker + append-only destination acceptance across multiple accounts.
- Physical power-loss/restart acceptance around ingest and migration checkpoints.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe/live billing end-to-end acceptance.

## Next prioritized batch

Wire `LegacyWholeFileCompatibilityTelemetry` into production `receiveMedia()` without changing ingest semantics: record accepted/duplicate/rejected attempts by resolved auth mode, expose sanitized counters/readiness through existing operator diagnostics (not a mock control), and append only credential-free audit metadata. Keep physical-device resumable acceptance false by default and fail closed until an explicit release acceptance artifact can set it true.
