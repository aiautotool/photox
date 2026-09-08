# V4 Run 085 — Physical Resumable Acceptance Evidence Gate

## Scope

This run continues the legacy whole-file compatibility retirement work from Run 084. It does not retire or restrict the whole-file route. Instead it replaces the previous hard-coded physical-device acceptance placeholder with durable, release-bound evidence while keeping retirement fail-closed.

## Implemented

- Added a versioned physical-device resumable acceptance evidence contract for iOS and Android.
- Evidence must prove the required scenario: network interruption, process kill, app restart, authoritative server offset recovery, resume from that exact byte, complete verified asset, zero duplicate quota bytes and zero duplicate catalog rows.
- Added an append-only atomic JSON evidence ledger under Desktop state with duplicate evidence IDs rejected.
- Corrupt/unknown/invalid evidence fails closed and cannot grant acceptance.
- Added production acceptance evaluation bound to the exact packaged release commit SHA from `PHOTOX_RELEASE_COMMIT_SHA`.
- Production requires a full 40-character commit SHA. Missing/invalid release identity blocks acceptance.
- Both iOS and Android evidence are required by default for a release to pass physical resumable acceptance.
- Wired evidence-derived acceptance into `legacyWholeFileCompatibilityDiagnostics()` and therefore the existing deprecation-readiness gate.
- There is deliberately no mutable UI/config `accepted` switch.
- Operator diagnostics expose only aggregate acceptance state/platform blockers; the compatibility route still requires telemetry persistence health, a completed observation window and zero compatibility traffic before it can ever become retirement-ready.

## Validation

Regression coverage includes:

- contract parsing and acceptance invariants;
- exact release SHA matching;
- iOS + Android requirement;
- append-only durable ledger and restart survival;
- duplicate evidence ID rejection;
- corrupt ledger fail-closed behavior;
- production readiness deriving `physicalDeviceResumableAccepted=true` only from exact-release evidence;
- missing release commit identity remaining blocked.

CI note: the production wiring commit (`a7560706eac4afd4fbb6cf921615af3999db1eb3`) completed full repository CI successfully. The subsequent test-only commit passed repository tests and TypeScript typecheck but its first CI attempt hit a production-build failure; because the production build on the immediately preceding code commit was green and the delta was test-only, the next full CI run must still complete green before this run is considered closed.

## Still NOT VERIFIED

- Physical iOS network-loss -> process-kill -> restart -> authoritative offset -> byte-exact resume -> verify acceptance on real hardware.
- Physical Android equivalent acceptance on real hardware.
- Signed IPA/APK/AAB release builds.
- Signed Windows/macOS installers.
- Live Google Drive and Google Photos multi-account migration acceptance.
- Physical power-loss recovery.
- Public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe live end-to-end billing acceptance.

## Next prioritized batch

Build the controlled evidence-capture workflow used by real-device acceptance runs. It should emit evidence from observed resumable protocol results rather than hand-entered values, bind the record to release/build/device/scenario identifiers, append it through the durable ledger, and expose read-only evidence status in the shared Desktop/Web operations UI. Do not add a normal acceptance toggle.
