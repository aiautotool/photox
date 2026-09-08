# V4 Run 081 — Durable whole-file compatibility telemetry

## Scope

This run continued directly from V4 Run 080. Before wiring legacy whole-file compatibility telemetry into the production receiver/operator diagnostics, it closed a correctness gap in the telemetry contract itself: Run 080 state was process-local, so restarting Desktop erased the observation history used by the seven-day deprecation-readiness gate.

## Analysis

A process-local observation window cannot safely authorize retirement of `POST /api/v1/media`. A Desktop restart could erase prior compatibility traffic and restart counters, making operator diagnostics incomplete. The deprecation signal therefore must survive restart and must fail closed when persisted state is absent, corrupt, counter-inconsistent, or from an unknown schema version.

This durability prerequisite is safer to complete before production wiring. It prevents a future operator surface from presenting a misleading readiness result.

## Implementation

- Extended `legacyWholeFileCompatibilityTelemetry.ts` with a versioned, credential-free persisted-state contract.
- Added strict persisted-state parsing and validation:
  - schema version must be exactly supported version `1`;
  - timestamps and counters must be valid non-negative values;
  - auth-mode and outcome totals must independently equal the authoritative total;
  - non-empty state must contain a valid last-observed timestamp;
  - invalid/unknown state is discarded and starts a fresh observation window, preserving fail-closed retirement behavior.
- Added `exportPersistedState()` so a validated observation window, counters, and last-observed timestamp can survive Desktop restart.
- Added `LegacyWholeFileCompatibilityTelemetryStore`:
  - JSON persistence contains only coarse telemetry state;
  - creates parent directories as required;
  - writes a same-directory temporary file and atomically renames it into place;
  - requests owner-only file mode where supported;
  - removes abandoned temporary files on failure;
  - missing or malformed JSON starts a fresh fail-closed observation window.
- Persisted state still excludes bearer tokens, pair credentials/challenges, workspace IDs, device IDs, filenames, media keys, network addresses, and request headers.

## Regression coverage

- Restored telemetry preserves `observedSince`, total counters, last-observed timestamp, and compatibility-traffic blocker across a simulated Desktop restart.
- Unknown schema versions restart the observation window instead of trusting stale state.
- Counter-inconsistent state is rejected instead of undercounting compatibility use.
- Atomic file-store roundtrip preserves compatibility evidence across restart.
- Missing telemetry file starts a fresh incomplete observation window.
- Corrupt JSON starts a fresh incomplete observation window.
- Persisted JSON remains credential/identity free.

## Validation

Code HEAD `c5d0f637224b10b21d01d09d54b026d4646fe41d` passed repository CI run 1007 / `34168254261`:

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux directory package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED because the execution environment cannot resolve `github.com`; GitHub Actions is the executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation remains authoritative-quota based with no fixed 10 GB cap: default PhotoX allocation is 2/3 of provider total quota, bounded by actual provider remaining bytes and safety reserve, with per-account configurable ratio.
2. Google Photos migration remains compliant: Google Photos Picker-selected source only, durable migration ledger/progress/pause/resume/retry/verification/account selection, append-only Google Photos destination or connected Google Drive destination, and no unrestricted full-library crawling claim.
3. Web and Desktop continue to share the exact React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session authorization, roles, and public-edge security controls.

## Remaining risks / NOT VERIFIED

- The durable telemetry store is implemented and tested but is not yet instantiated by production `main.ts`; live receiver events are therefore not persisted yet.
- Operator diagnostics do not yet expose the sanitized telemetry snapshot/readiness.
- Physical Android/iOS network-loss → process kill → restart → byte-offset resumable acceptance.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live Google Drive account acceptance and failure/recovery scenarios.
- Live Google Photos Picker + append-only destination acceptance across multiple accounts.
- Physical power-loss/restart acceptance around ingest, telemetry persistence, and migration checkpoints.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe/live billing end-to-end acceptance.

## Next prioritized batch

Wire the durable telemetry store into production Desktop startup and `receiveMedia()` using the existing user-data/application-data persistence boundary. Record accepted/duplicate/rejected attempts by resolved auth mode and persist them as non-fatal additive telemetry without changing ingest/quota/audit semantics. Expose only the sanitized snapshot and fail-closed deprecation readiness through existing operator diagnostics. Keep `physicalDeviceResumableAccepted=false` by default until an explicit physical-device release acceptance artifact exists.
