# V4 Run 077 — Whole-File HTTP Preflight Harness

## Starting point

This run continued from Run 076 on the latest `v4` branch. The production whole-file path already attributed bearer uploads to the authenticated workspace member, while pair-code and pairing-challenge remained explicitly legacy-compatible. The remaining acceptance gap was a real HTTP-boundary regression proving that identity/binding failures are rejected before ingest side effects.

`v3` remains intentionally untouched.

## Analysis

`desktop/electron/main.ts` is a large Electron entry module with substantial application lifecycle side effects. Importing it directly from a Node test would make the receiver test fragile, and rewriting the receiver inline before a harness existed would increase regression risk. The safe next step is therefore to isolate the deterministic whole-file preflight contract first, exercise that contract through a real Node HTTP server, and then wire the production receiver to consume it in the next batch.

## Implemented

Added `desktop/electron/legacyWholeFileReceiverPreflight.ts`.

The preflight contract resolves and validates, before ingest work begins:

- workspace identity;
- device identity;
- asset identity;
- stable media key (`deviceId:assetId`);
- authenticated-member versus legacy-compatibility audit attribution.

Bearer requests inherit authoritative workspace/device values from the principal only when compatibility headers are absent. If compatibility headers are present, the existing fail-closed attribution contract requires them to match the bearer principal. Missing asset/device/workspace identity is rejected before the caller proceeds to quota reservation or body streaming.

Added `desktop/electron/legacyWholeFileReceiverPreflight.test.ts` with a real ephemeral HTTP server. The integration regression proves:

- a correctly bound bearer request is attributed to the authenticated member/session/role;
- a workspace binding mismatch is rejected through HTTP before body reads, reservation simulation or audit simulation;
- pair-code requests remain explicitly tagged `legacy-compatibility`;
- missing asset identity fails before any ingest-side-effect counter is touched.

This batch deliberately does not yet replace the corresponding inline block in `main.ts`; the new harness is the safety boundary that will support that refactor next.

## Validation

Code HEAD `d02db7ed41858109b7d5eeb87c17bcbcc589dc33` passed GitHub Actions CI run 992 (`34153041176`) completely:

- dependency install — PASS;
- repository tests — PASS;
- TypeScript typecheck — PASS;
- production build — PASS;
- built Desktop renderer smoke — PASS;
- electron-builder package — PASS;
- packaged Desktop application smoke — PASS.

Local clone/test/build is NOT VERIFIED in the execution container because DNS resolution for `github.com` is unavailable there; GitHub Actions remains the executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation remains non-fixed: PhotoX defaults to `2/3` of each account's authoritative total Google storage quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API: Picker-selected source media only; append-only upload to another Google Photos account or transfer to a connected Google Drive account; durable ledger/progress/pause/resume/retry/verification/account selection; no unrestricted full-library crawling claim.
3. Web remains the same shared React UI/components/styles as Desktop through the `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable host/port/domain/reverse-proxy exposure, Range streaming, workspace/session auth, role enforcement, CORS/CSRF/rate limiting and audit controls.

## Remaining risks / not yet verified

- Production `main.ts::receiveMedia()` still contains the equivalent preflight logic inline; the new module is tested but not yet the single source of truth in production.
- Duplicate behavior still needs to be added to the HTTP-boundary harness when production wiring is switched to the extracted preflight.
- Physical Android/iOS network-loss → process-kill → restart → byte-offset resumable acceptance is NOT VERIFIED.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED in this environment.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Physical power-loss acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.

## Next prioritized batch

Wire `main.ts::receiveMedia()` to consume `resolveLegacyWholeFileReceiverPreflight()` so the tested contract becomes the production single source of truth. Extend receiver-boundary coverage to duplicate handling and verify that binding rejection creates no media row, quota reservation, file or audit side effects. After that, define a measurable whole-file deprecation gate based on physical-device resumable acceptance and compatibility telemetry rather than deleting compatibility prematurely.
