# V4 Run 083 — Whole-file compatibility telemetry production wiring

## Context

Run 082 completed a durable, non-fatal compatibility telemetry runtime but left it disconnected from the production Desktop receiver. The next safe batch was to collect live legacy whole-file usage without changing media ingest/quota/catalog/audit semantics, then expose sanitized readiness diagnostics to Desktop/Web operators.

## Implemented

- Added `legacyWholeFileCompatibilityTelemetryProduction.ts` as the production binding for the durable runtime/store.
- The binding is initialized from the authoritative Desktop state directory during the existing pre-SQLite media-index startup preparation path.
- `resolveLegacyWholeFileReceiveGate()` now records aggregate compatibility traffic at the pre-ingest boundary:
  - `accepted` when a request passes identity/binding/duplicate preflight;
  - `duplicate` when the authoritative media key already exists;
  - `rejected` when preflight/binding/duplicate evaluation fails.
- `accepted` intentionally means accepted by the legacy pre-ingest gate, not successful media commit. This keeps telemetry observational and unable to alter quota/file/catalog/audit transaction semantics while still proving that a client depends on the legacy route.
- Auth mode remains coarse-grained (`bearer`, `pair-code`, `pairing-challenge`). No bearer token, pairing credential, workspace/device/media identity, filename, IP or request headers are persisted.
- Desktop and Web admin media-catalog operator diagnostics now include `legacyWholeFileCompatibility` aggregate telemetry and fail-closed deprecation readiness.
- Physical-device resumable acceptance remains hard-coded false in production diagnostics. Route retirement cannot become ready from telemetry alone.
- Added regression coverage that starts from the real Desktop state-path bootstrap, exercises accepted/duplicate/rejected traffic, flushes the durable store, validates aggregate counters/readiness, and verifies that persisted state contains no request/member/workspace/device/asset identifiers.

## Safety / behavior invariants

- Telemetry persistence remains best-effort and non-fatal to media requests.
- Persistence failure blocks deprecation readiness instead of weakening ingest behavior.
- Existing HTTP 201/208/403 semantics remain owned by the receiver/gate paths; telemetry adds no mock UI or alternate ingest state.
- Web diagnostics remain admin/owner gated by the existing operations transport and continue to redact local filesystem recovery metadata.

## Priority requirements carried forward

1. Google Drive allocation remains authoritative-quota based: default PhotoX allocation is 2/3 of each account total quota, constrained by real provider remaining bytes and safety reserve, with configurable per-account ratio. No fixed 10 GiB allocation cap is introduced.
2. Google Photos migration remains compliant with the current Picker API for user-selected source media and append-only destination upload to Google Photos or connected Google Drive. Do not advertise unrestricted library crawling.
3. Web continues to share the Desktop React UI/components/styles through the `DesktopBridge` contract and authenticated HTTP/WebSocket adapters with tenant/session/role security and Range streaming.

## Validation

The branch push triggers the repository CI workflow, which runs repository tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging and packaged Desktop smoke. Platform-specific signed mobile/macOS/Windows artifacts remain NOT VERIFIED where signing/device infrastructure is unavailable.

## Remaining risks / next batch

- Physical Android/iOS network-loss -> process-kill -> restart -> resumable byte-offset recovery is still NOT VERIFIED; until that is accepted, deprecation readiness must remain false.
- Best-effort shutdown flush is not yet wired directly into Electron `before-quit`; atomic per-event persistence substantially limits exposure, but explicit shutdown coordination should still be added when `main.ts` can be patched safely.
- Operator diagnostics expose the aggregate contract, but the shared Desktop/Web UI does not yet render a dedicated compatibility/deprecation operations card.

Next priority: add a real operations UI surface using the existing shared Desktop/Web React components to show legacy whole-file usage, persistence health and deprecation blockers without credentials/identifiers; then add an explicit physical-device acceptance workflow/flag that can only be set by verified acceptance evidence, not a normal UI toggle.
