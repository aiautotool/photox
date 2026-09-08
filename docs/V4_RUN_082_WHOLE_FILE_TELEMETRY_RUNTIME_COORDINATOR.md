# V4 Run 082 — Whole-file telemetry runtime coordinator

## Scope

This run continued directly from V4 Run 081. The durable JSON store already existed, but wiring it directly into `main.ts::receiveMedia()` would have coupled media ingest to telemetry I/O unless a production-facing coordinator first defined serialization, non-fatal persistence, and fail-closed diagnostics semantics.

## Analysis

Compatibility telemetry is additive operational evidence. A telemetry write failure must never make an otherwise valid media upload fail, reserve quota incorrectly, change duplicate semantics, or alter audit/catalog commits. At the same time, a failed telemetry write means compatibility evidence may not survive restart, so deprecation readiness must not remain green while persistence is unhealthy.

A runtime coordinator is therefore required between the receiver and the durable store:

- record in memory synchronously;
- serialize saves so an older slow write cannot overwrite a newer snapshot;
- swallow persistence failures from the media-request path;
- surface persistence health only as sanitized operator diagnostics;
- fail closed for route retirement whenever telemetry durability is unhealthy;
- keep physical-device resumable acceptance false by default.

## Implementation

- Added `LegacyWholeFileCompatibilityTelemetryRuntime`.
- Added production-facing store abstraction over the existing durable telemetry store.
- `record()` updates in-memory counters immediately and enqueues durable saves in order.
- `flush()` provides deterministic shutdown/test synchronization without changing request semantics.
- Store load failure starts a fresh observation state and marks persistence unhealthy rather than trusting missing evidence.
- Store save failure is caught and reported through an optional error callback; it never rejects the media caller.
- A later successful save restores persistence health.
- Operator diagnostics expose only:
  - credential-free compatibility snapshot;
  - deprecation readiness;
  - persistence health plus coarse timestamps.
- Deprecation readiness is forced false with `TELEMETRY_PERSISTENCE_UNHEALTHY` whenever durable evidence cannot be trusted.
- `physicalDeviceResumableAccepted` remains false unless an explicit caller supplies true after real physical-device acceptance.

## Regression coverage

- Multiple compatibility events serialize into durable state.
- Bearer and pair-code counters/outcomes persist correctly.
- Save failure does not throw from `record()`.
- Save failure blocks deprecation readiness.
- Load failure starts with zero trusted traffic while still blocking deprecation because persistence is unhealthy.
- Operator diagnostics default physical-device acceptance to false.
- Serialized diagnostics remain free of token, credential, workspace/device/media identity, filename, and Authorization material.

## Validation

Code HEAD `4449c7a59c0a0dd2b7761379e215f8f6f5bf0a8b` passed CI run 1011 / `34171411707`:

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux directory package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED because the execution container cannot resolve `github.com`; GitHub Actions remains the executable validation path.

## Priority requirements carried forward

1. Google Drive allocation remains authoritative-quota based with no fixed 10 GB cap: default PhotoX allocation is 2/3 of provider total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant: Google Photos Picker-selected source only, durable migration ledger/progress/pause/resume/retry/verification/account selection, append-only Google Photos destination or connected Google Drive destination, and no unrestricted full-library crawling claim.
3. Web and Desktop continue to share the exact React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session authorization, roles, and public-edge security controls.

## Remaining risks / NOT VERIFIED

- The runtime coordinator is implemented and tested but production `main.ts` still does not instantiate it or record live receiver outcomes.
- Operator diagnostics do not yet expose this runtime through the existing Desktop/Web bridge.
- Physical Android/iOS network-loss → process kill → restart → byte-offset resumable acceptance.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live Google Drive account acceptance and failure/recovery scenarios.
- Live Google Photos Picker + append-only destination acceptance across multiple accounts.
- Physical power-loss/restart acceptance around ingest, telemetry persistence, and migration checkpoints.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe/live billing end-to-end acceptance.

## Next prioritized batch

Instantiate `LegacyWholeFileCompatibilityTelemetryRuntime` at Desktop startup using a telemetry file under the existing `stateDir()` boundary, wire `accepted` / `duplicate` / `rejected` events from production `receiveMedia()` by resolved auth mode, flush best-effort at shutdown, and expose only `runtime.diagnostics()` through the existing operator diagnostics transport. Keep recording non-blocking and keep `physicalDeviceResumableAccepted=false` until a real physical-device release acceptance artifact exists.
