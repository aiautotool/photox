# V4 Run 092 — Live Physical Acceptance Diagnostics Refresh

## Goal

Continue directly from Run 091 and remove the Desktop-restart requirement after a controlled real-device resumable acceptance run. Keep the existing shared Desktop/Web Operations transport and UI read-only, while making its physical acceptance status reflect newly persisted durable evidence in the same running Desktop process.

## Analysis

Run 091 exposed controlled capture/evidence/server-authority health through the existing admin/owner Operations surface, but `physicalResumableAcceptanceProduction` retained the startup snapshot in memory. A successfully completed acceptance run appended durable evidence, yet the 15-second shared Operations polling kept receiving the stale startup snapshot until Desktop restarted.

The safest fix is event-driven rather than adding a new endpoint, timer, mutable control, or filesystem watcher. The acceptance ingestion path already has the exact durable boundary: `appendObservedRun()` only returns after append-only evidence persistence succeeds. That boundary can trigger a best-effort reload of the credential-free diagnostics snapshot from the same durable evidence and server-authority ledgers.

## Implemented

- Refactored production physical acceptance diagnostics loading into a reusable durable-state loader.
- Added `refreshPhysicalResumableAcceptance(...)`:
  - reloads exact-release immutable evidence;
  - reloads controlled capture/server-authority ledger health and aggregate record count;
  - preserves existing fail-closed behavior for missing release identity, unhealthy evidence persistence, corrupt authority state, or invalid capture mode;
  - exposes no filesystem path, workspace/device/media/session identity, credentials, request headers, or media content.
- Production initialization now remembers only the state-directory/release configuration required for read-only refresh.
- Extended `PhysicalResumableAcceptanceIngestion` with an optional post-persistence hook.
- Production resumable composition wires that hook to diagnostics refresh after evidence has been durably appended.
- Refresh is best-effort after durable evidence persistence. A diagnostics refresh failure cannot turn a successfully persisted acceptance submission into an HTTP failure and cannot provoke duplicate client retries.
- No new HTTP endpoint, Electron IPC method, Web permission, role grant, UI button, `mark accepted`, `force pass`, or route-retirement control was added.

## Regression coverage

Added regression proving that:

1. Desktop/telemetry starts with only iOS evidence and physical acceptance is false.
2. Android evidence is durably appended after startup.
3. Refresh runs without resetting/restarting the production telemetry runtime.
4. The existing operations diagnostics immediately report both accepted platforms, evidence count 2, and physical resumable acceptance true.
5. Deprecation readiness consumes that refreshed evidence-derived physical acceptance rather than a stale startup snapshot.

The existing Run 090 production-shaped receiver restart test continues to cover `create → partial upload → restart/status → resume → finalize → acceptance`, and production composition now refreshes operations state at its durable evidence boundary.

## Validation

Code HEAD `1d0f3993a8e6b04e131cc2b16cd9af60b4d2117e` passed repository CI run 1069 (`34212831274`):

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

The execution environment still cannot be treated as a local native-platform verification environment; signed/native packages and real-device acceptance remain NOT VERIFIED below.

## P0 invariants carried forward

1. Google Drive allocation remains free of a fixed 10 GB PhotoX cap. Default allocation is 2/3 of each Google account's authoritative total quota, bounded by actual remaining provider bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, using the current Google Photos Picker API and append-only destination upload to another Google Photos account or a connected Google Drive account. PhotoX must not advertise unrestricted full-library crawling.
3. Desktop and Web continue to use the same React UI/components/styles through the shared `DesktopBridge`, with authenticated HTTP/WebSocket adapters for Web and Electron IPC for Desktop. Public Web exposure keeps workspace/session auth, role enforcement and existing security boundaries.

## Remaining risks / NOT VERIFIED

- Real iOS and Android hardware: network interruption → OS process kill → app restart → authoritative status → exact-byte resume → finalize → acceptance submission.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live multi-account Google Drive allocation/provider acceptance.
- Live Google Photos Picker migration between real accounts and to Google Drive.
- Physical power-loss recovery.
- Production TLS/reverse-proxy/WebSocket/Range deployment.
- Stripe live end-to-end billing.

## Next prioritized batch

Harden the production acceptance HTTP boundary with transport-level regressions for corrupt authority state and authenticated workspace/device/session/asset mismatches that are not yet covered end-to-end. Verify each rejection leaves the append-only evidence ledger unchanged and returns only coarse error codes without identity/ledger leakage. Then continue provider/live acceptance work, prioritizing real Google Drive quota-allocation verification and Google Photos Picker migration acceptance without weakening the three P0 invariants.
