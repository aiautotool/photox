# V4 Run 090 — Production Physical Acceptance Restart E2E

## Goal

Close the next acceptance gap from Run 089 with a production-shaped regression that proves the controlled physical resumable acceptance composition survives receiver restart and can only persist evidence derived from independent server authorities.

## Implemented

- Extended `desktop/electron/resumableMediaProductionRuntime.test.ts` with a full controlled acceptance lifecycle using the real production composition.
- The test resolves acceptance configuration through `controlledPhysicalAcceptanceFromEnvironment(...)` with an isolated environment object rather than mutating process-global environment variables.
- The flow now proves:
  1. create a resumable upload session;
  2. upload only a prefix of the asset;
  3. stop the first receiver runtime;
  4. create a second receiver runtime against the same durable state;
  5. query authoritative server status after restart and recover the acknowledged byte offset;
  6. resume from exactly that byte;
  7. finalize and verify the committed media;
  8. submit the mobile chronology artifact through the authenticated acceptance HTTP endpoint;
  9. append immutable physical acceptance evidence;
  10. reopen the evidence store and verify the evidence persisted across runtime boundaries.
- The workspace test authority now exposes `getUsage()` from committed reservations, so quota-before/quota-after evidence is independently derived from workspace-authoritative managed storage bytes.
- Catalog-before/catalog-after evidence comes from the same production `exists(...)` authority used by the active ingest composition.
- The regression asserts zero duplicate quota bytes and zero duplicate catalog rows.
- Added an HTTP trust-boundary regression proving that an otherwise valid mobile report with an injected server-authoritative field is rejected and cannot append a second evidence record.

## Security / correctness invariants

- Normal Desktop startup remains unchanged; controlled acceptance still defaults OFF.
- No UI or operator toggle can mark physical acceptance as passed.
- Mobile supplies chronology and release/device/upload identity only.
- Authoritative restart offset is obtained from the server status path after receiver restart.
- Final bytes/verification, workspace quota and catalog observations are populated by the durable server authority ledger, not the mobile report.
- Evidence remains release-bound and append-only.
- The production upload remains byte-exact after restart and the committed file is verified against the original payload.

## Validation

Code commit `e345efa53a84c7d3bd26a9a8ba91f510cc181a2a` passed GitHub Actions CI run 1058 (`34201792686`):

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

Physical iOS/Android hardware execution is still NOT VERIFIED. Signed IPA/APK/AAB and signed Windows/macOS release builds remain NOT VERIFIED in this environment.

## P0 requirements carried forward

1. Google Drive allocation must never fall back to a fixed 10 GB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, with append-only upload to the destination Google Photos account or transfer to a connected Google Drive account. Do not advertise unrestricted full-library crawling.
3. Desktop and Web remain one shared React UI/component/style surface through `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters plus production public-access controls.

## Remaining acceptance risks

- The regression simulates a process restart at the receiver runtime boundary; actual iOS and Android network-loss -> OS process kill -> app restart has not yet been executed on hardware.
- Physical-device evidence must still be captured for both required mobile platforms for the exact release SHA before the deprecation gate can become ready.
- Signed mobile and desktop artifacts, live Google Drive/Google Photos multi-account acceptance, physical power-loss recovery, public TLS/reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.

## Next prioritized batch

Expose controlled capture readiness in the shared Desktop/Web Operations surface without adding any acceptance toggle. Show whether controlled mode is enabled for the running release, release SHA binding, server-authority ledger health, evidence ledger health, required-vs-accepted physical platforms and blockers. Then add focused corruption/identity regressions at the production HTTP boundary where coverage is not already provided by lower-level authority/ingestion tests.
