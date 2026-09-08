# V4 Run 086 — Real-device resumable capture workflow

## Scope

This run continues Run 085 without changing or retiring the legacy whole-file route. It builds the controlled evidence-capture boundary needed for real iOS/Android resumable acceptance and exposes evidence-derived status in the existing shared Desktop/Web operations UI.

## Implemented

- Added `physicalResumableAcceptanceCapture.ts` as the controlled append path for observed physical-device runs.
- Capture input is bound to release app version, build number, exact 40-character commit SHA, device platform/model/OS and a unique run identifier.
- The capture requires explicit chronological observations for network interruption, process kill, app restart, server-authoritative offset recovery, resume start, completion and authoritative post-run snapshots.
- Server offset observations must identify their source as `server-authoritative`.
- Quota snapshots must identify their source as `workspace-authoritative`.
- Catalog snapshots must identify their source as `catalog-authoritative`.
- Duplicate quota bytes and duplicate catalog rows are derived from authoritative before/after snapshots. They are not accepted as operator-entered pass/fail values.
- Offset mismatch, incomplete verification or derived duplicate effects produce evidence that does not satisfy the independent physical acceptance predicate.
- Impossible chronology, invalid release/device identity, non-authoritative sources and unsafe counters fail closed.
- `PhysicalResumableAcceptanceCaptureWorkflow` appends derived records through the existing append-only atomic evidence ledger. Duplicate run/evidence IDs remain rejected.
- There is still no mutable `accepted` field or UI toggle.
- Extended the shared Desktop/Web operations view model with evidence-store initialization/health, release commit, evidence count, required platforms, accepted platforms and evidence blockers.
- Extended the existing shared operations panel with a read-only `Physical-device evidence` section. No new transport or privilege surface was introduced; it continues to consume the existing authenticated operations diagnostics path.

## Regression coverage

- passing authoritative observation derives acceptance evidence;
- server offset mismatch remains non-accepted;
- duplicate quota/catalog effects are derived from authoritative deltas;
- impossible event chronology is rejected;
- non-authoritative observation source is rejected;
- derived evidence survives the durable store and duplicate run IDs are rejected;
- operations view exposes evidence-derived release/platform/store status and remains fail-closed when not initialized.

## Validation

GitHub Actions CI run 1037 (`34185072620`) on code HEAD `a96ec6302061c395e06c6b47f22e79adbc67a9c8` completed successfully:

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

- Actual physical iOS capture emitted from the running mobile resumable protocol.
- Actual physical Android capture emitted from the running mobile resumable protocol.
- Physical network-loss -> kill -> restart -> server-offset -> byte-exact resume acceptance on either platform.
- Signed IPA/APK/AAB release builds.
- Signed Windows/macOS installers.
- Live Google Drive and Google Photos multi-account migration acceptance.
- Physical power-loss recovery.
- Public TLS/reverse-proxy/WebSocket/Range deployment acceptance.
- Stripe live end-to-end billing acceptance.

## Next prioritized batch

Wire the mobile resumable client to emit a release-bound, structured acceptance-run observation from real protocol events instead of requiring an external harness to assemble the observation. Keep the capture disabled outside an explicit acceptance-test mode, avoid credentials/media content in the artifact, and provide a controlled authenticated ingestion path on Desktop that validates the observation and appends through `PhysicalResumableAcceptanceCaptureWorkflow`. Add end-to-end regression proving a captured mobile observation cannot spoof authoritative server offset, workspace quota or catalog snapshots.
