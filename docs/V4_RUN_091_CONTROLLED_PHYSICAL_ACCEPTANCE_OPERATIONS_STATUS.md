# V4 Run 091 — Controlled Physical Acceptance Operations Status

## Goal

Continue directly from Run 090 and expose the controlled real-device resumable acceptance state through the existing shared Desktop/Web Operations surface without adding any mutable acceptance control or a new transport boundary.

## Analysis

The shared Operations panel already displayed immutable physical-device evidence (release commit, evidence count, required/accepted platforms and evidence blockers), but it could not tell an operator whether controlled capture was enabled or whether the independent server-authority ledger was readable. That made real-device acceptance troubleshooting incomplete even though the underlying controlled mode and durable authority ledger were already production-wired.

The safest path is to extend the existing credential-free `physicalResumableAcceptance` diagnostics that already flow through the admin/owner-protected media catalog operations transport. No new HTTP endpoint, Electron IPC method, role grant, or write action is required.

## Implemented

- Extended production physical-resumable diagnostics with read-only capture status:
  - `captureMode`: `disabled`, `real-device`, or fail-closed `invalid`.
  - `captureEnabled`.
  - server-authority ledger initialized/healthy state.
  - aggregate server-authority record count only.
  - capture blockers.
- The exact release commit SHA remains part of evidence diagnostics and is displayed in the shared UI.
- Added conservative server-authority ledger inspection:
  - missing ledger in explicit `real-device` mode is healthy-but-not-initialized and reports `PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_NOT_INITIALIZED`;
  - malformed/unknown ledger shape is unhealthy and reports `PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_UNHEALTHY`;
  - no filesystem path, workspace ID, device ID, asset ID, session ID, credentials, request headers, or media content is exposed.
- Extended the existing shared Desktop/Web view-model with controlled capture and authority health fields.
- Extended the shared `◉ Hệ thống` Operations panel to show:
  - capture mode enabled/disabled/fail-closed;
  - release commit;
  - server-authority ledger health and record count;
  - evidence-store health/count;
  - required vs accepted iOS/Android platforms;
  - capture blockers and evidence blockers separately.
- UI remains strictly read-only. There is still no `mark accepted`, `force pass`, or `retire route` control.

## Regression coverage

Added/extended regressions for:

- controlled `real-device` mode appearing in production diagnostics;
- corrupt server-authority ledger failing closed;
- exact release SHA retained in diagnostics;
- shared view-model mapping capture mode, authority health/count and blockers;
- missing telemetry defaulting to disabled capture without inventing acceptance;
- unhealthy server authority remaining visibly unhealthy and never creating physical acceptance.

## Validation

Code HEAD `edcb59d02b60d63ef530db0590b706d9ae5fe0da` passed repository CI run 1064 (`34207193268`):

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

Platform-specific signed packages and real hardware acceptance remain NOT VERIFIED as listed below.

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

Harden the production acceptance HTTP boundary around the server-authority ledger: add transport-level regressions for corrupt authority state and authenticated identity/session/asset mismatches that are not already covered end-to-end. Then make controlled capture diagnostics refresh from authoritative durable state after a completed acceptance run without requiring Desktop restart, while preserving fail-closed behavior and avoiding filesystem/identity leakage.
