# V4 Run 087 — Mobile resumable acceptance instrumentation

## Scope

This run continues Run 086 and the follow-up server-side anti-spoofing commits already present on `v4`. It wires explicit physical-device acceptance instrumentation into the real mobile resumable upload progress/finalize path and adds an authenticated, fail-closed HTTP ingestion boundary for acceptance reports. The production authority recorder is intentionally not fabricated: until it is wired, the acceptance endpoint stays unavailable and no evidence can be granted.

## Implemented

- Added `mobile/src/sync/physicalResumableAcceptance.ts` as a durable acceptance-test recorder backed by Expo SecureStore.
- Acceptance capture is opt-in only: normal sync never creates an acceptance run. Test tooling must explicitly bind a run ID, exact 40-character release commit SHA, app version/build, iOS/Android device model/OS and asset ID.
- The mobile durable state contains no auth token, pairing credential, filename or media content.
- Added explicit network-interruption and process-kill-imminent markers. The kill marker is persisted before the harness asks the OS to terminate the process; the code does not pretend a killed process can emit an event after termination.
- The real `ResumableUploadClient` progress callback now feeds acceptance observation. After restart, the first server-refreshed session progress records the untrusted mobile `resumedFromByte` claim.
- Successful real resumable finalize triggers report submission only when a complete explicit acceptance run exists.
- Acceptance observation/submission failures never turn already-committed media into a backup failure. The durable report remains retryable.
- Non-acceptance assets use an in-process negative cache so the instrumentation does not read SecureStore for every uploaded chunk.
- Added `POST /api/v1/media/uploads/acceptance` support to the existing resumable HTTP namespace.
- The acceptance route uses the same authenticated resumable device principal and passes authoritative `workspaceId`/`deviceId` from that principal to the ingestion service; body-provided workspace/device identity is never authoritative.
- The route is deliberately unavailable (`404`) unless an authoritative acceptance ingestion service has been wired. There is no fallback, mock acceptance or mutable pass toggle.
- Existing `PhysicalResumableAcceptanceIngestion` remains responsible for rejecting client-supplied server/quota/catalog authority and for replacing those values from `PhysicalResumableServerAuthority`.

## Regression coverage

Added `desktop/electron/resumableAcceptanceHttp.test.ts` covering:

- unauthenticated acceptance submission is rejected before ingestion;
- authenticated workspace/device binding comes from the server principal rather than the report body;
- the route stays unavailable when no authoritative ingestion service is configured;
- existing JSON body-size limits are enforced before acceptance ingestion.

The prior v4 regression also continues to prove mobile reports cannot supply server offset, workspace quota, catalog authority or authoritative verification fields.

## Validation

GitHub Actions CI run 1046 (`34189753301`) on code HEAD `355a5cea84ef6419e6848150378fa09062f6fe13` completed successfully:

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED because the execution container cannot resolve `github.com`; GitHub Actions is the executable validation path for this run.

## P0 requirements carried forward

1. Google Drive allocation must never regress to a fixed 10 GB cap. Default PhotoX allocation remains 2/3 of authoritative total account quota, constrained by actual remaining provider bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, with append-only upload to a destination Google Photos account or transfer to a connected Google Drive account. PhotoX must not advertise unrestricted Google Photos full-library crawling.
3. Desktop and Web continue to use the same React UI/components/styles through the shared DesktopBridge contract, with authenticated HTTP/WebSocket adapters and the existing Web security controls.

## Still NOT VERIFIED

- The Desktop production runtime does not yet wire a `PhysicalResumableServerAuthority` implementation into the new acceptance HTTP route; production therefore fails closed with the route unavailable rather than accepting unverifiable evidence.
- Actual physical iOS network-loss -> kill -> restart -> authoritative offset -> byte-exact resume acceptance.
- Actual physical Android network-loss -> kill -> restart -> authoritative offset -> byte-exact resume acceptance.
- Signed IPA/APK/AAB release builds.
- Signed Windows/macOS installers.
- Live Google Drive and Google Photos multi-account migration acceptance.
- Physical power-loss recovery.
- Public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe live end-to-end billing acceptance.

## Next prioritized batch

Build the production `PhysicalResumableServerAuthority` recorder inside the existing resumable receiver lifecycle. Persist release/run-bound authoritative observations at session creation/status/finalize: server acknowledged offset after restart, workspace managed-storage/quota snapshots and catalog-row snapshots. Bind observations to the authenticated workspace/device/session/asset, reject mismatched or stale run IDs, then instantiate `PhysicalResumableAcceptanceIngestion` with the existing append-only evidence store and wire it into `createResumableMediaReceiverRuntime`. Add HTTP-level end-to-end regression proving a mobile report can only become acceptance evidence when the server-side authoritative observation ledger independently matches the run.