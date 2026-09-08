# V4 Run 079 — Whole-file production gate wiring

## Scope

This run continued from V4 Run 078 and made the tested whole-file pre-ingest gate the production source of truth for the legacy `POST /api/v1/media` compatibility receiver.

## Analysis

Before this run, `main.ts::receiveMedia()` duplicated workspace/device/asset/audit/duplicate logic inline even though `resolveLegacyWholeFileReceiveGate()` already owned the executable pre-ingest contract. That duplication allowed runtime and tests to drift. In particular, the inline receiver could construct a key such as `device:` when `x-photosync-asset-id` was missing and proceed toward quota reservation/temp-file creation rather than failing at the identity boundary.

The shared gate already guarantees that workspace/device/asset identity and authenticated-member vs legacy-compatible audit attribution are resolved before the authoritative duplicate check. Invalid bearer binding, missing device, and missing asset therefore fail before ingest side effects.

## Implementation

- `desktop/electron/main.ts` now imports and calls `resolveLegacyWholeFileReceiveGate()` after authentication/auth-mode selection.
- Production derives `workspaceId`, `deviceId`, `assetId`, immutable media key, and audit attribution from `gate.preflight` instead of re-reading those identities inline.
- Gate failures return HTTP 403 JSON before quota reservation, request-body streaming, temp-file creation, catalog ingest, or audit append.
- Authoritative pre-ingest duplicates still preserve the existing HTTP 208 `{ state: "ALREADY_RECEIVED" }` compatibility response before quota/body/temp-file work.
- The existing `mediaIngestCommitCoordinator` remains in place after upload streaming to reconcile concurrent/racing duplicates safely; its duplicate paths still release the reservation and remove the temp file.
- Added `legacyWholeFileProductionWiring.test.ts` to lock the architectural invariant that production `receiveMedia()` consumes the shared gate and does not reintroduce the old direct header/audit-attribution path.

## Validation

Code HEAD `3d15da2fdee062828a0c0a2b6f0daeadecb78553` passed repository CI run 999 / `34161143475`:

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

- Physical Android/iOS network-loss → process kill → restart → byte-offset resumable acceptance.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live Google Drive account acceptance and failure/recovery scenarios.
- Live Google Photos Picker + append-only destination acceptance across multiple accounts.
- Physical power-loss/restart acceptance around ingest and migration checkpoints.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe/live billing end-to-end acceptance.
- The legacy whole-file compatibility route still exists intentionally; removal must be gated by physical-device resumable acceptance and compatibility-use telemetry rather than done prematurely.

## Next prioritized batch

Add executable compatibility telemetry/deprecation readiness for the legacy whole-file route: count and audit bearer whole-file, pair-code, and pairing-challenge usage; expose operator diagnostics without leaking secrets; define a fail-safe deprecation readiness decision based on observed compatibility traffic plus physical-device resumable acceptance. Preserve the route until those gates prove it is safe to retire or restrict.
