# V4 Run 076 — Whole-File Authenticated Audit Wiring

## Starting point

This run continued from the latest `v4` state after Run 075. The fail-closed whole-file attribution contract already existed, but production `main.ts::receiveMedia()` still wrote `media.ingest` audit rows with the legacy owner identity even for authenticated workspace-member bearer uploads.

`v3` is intentionally untouched.

## Analysis

The safest production wiring is to reuse the bearer principal already authorized by the outer receiver dispatcher instead of authenticating the same request a second time. Identity attribution must also be resolved before body streaming and quota reservation so a workspace/device mismatch fails before ingest side effects begin.

Pair-code and pairing-challenge compatibility uploads still do not prove a SaaS member identity. They must remain visibly classified as legacy compatibility attribution.

## Implemented

Updated `desktop/electron/main.ts` to consume `legacyWholeFileAuditAttribution()` in the real `POST /api/v1/media` path.

- The outer receiver now carries the already-authorized bearer principal into `receiveMedia()`.
- `receiveMedia()` reuses that principal; its direct-call fallback can still authorize when no principal was supplied.
- Bearer audit attribution is resolved before media body streaming or workspace quota reservation.
- Bearer uploads now write the authoritative token `subject` as `actorUserId` and authoritative token device as `actorDeviceId`.
- Bearer audit metadata records `transport: whole-file`, `attribution: authenticated-member`, `authMode: bearer`, plus session/role when available.
- Pair-code and pairing-challenge uploads retain the legacy compatibility actor and explicitly record `attribution: legacy-compatibility` with their real compatibility auth mode.
- Attribution binding failures return HTTP 403 with no ingest/quota side effects.
- Existing whole-file duplicate handling, ingest commit coordinator, recovery journal, video processing, Drive replica queue and compatibility behavior are preserved.

The code diff from Run 075 is intentionally narrow: only `desktop/electron/main.ts` changed, with 20 additions and 6 deletions before this documentation commit.

## Validation

Code commit `d3d8aa0837cca18269ed9f4d30c3321c994acbf7` passed GitHub Actions CI run 989 (`34149533149`):

- dependency install — PASS;
- repository tests — PASS;
- TypeScript typecheck — PASS;
- production build — PASS;
- built Desktop renderer smoke — PASS;
- electron-builder package — PASS;
- packaged Desktop application smoke — PASS.

Local clone/test/build remains NOT VERIFIED in this execution environment because `github.com` DNS resolution is unavailable there; GitHub Actions is the executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation remains non-fixed. Default PhotoX allocation is `2/3` of each account's authoritative total Google storage quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API: Picker-selected source media only, append-only Google Photos destination uploads or connected Google Drive destination, durable ledger/progress/pause/resume/retry/verification/account selection, and no claim of unrestricted full-library crawling.
3. Web continues to use the shared Desktop React UI/components/styles and `DesktopBridge` contract with Electron IPC plus authenticated HTTP/WebSocket adapters, configurable host/port/domain/reverse-proxy exposure, Range streaming, workspace/session auth, role enforcement, CORS/CSRF/rate limiting, and audit controls.

## Remaining risks / not yet verified

- The whole-file authenticated-member audit path is production-wired and compile/build gated, but a process-level receiver integration test that boots the real Electron receiver with isolated stores is still desirable before declaring the legacy route fully acceptance-tested.
- The legacy whole-file route remains present only for compatibility; resumable is the preferred mobile transport across LAN/Public/Relay.
- Physical Android/iOS network-loss → process-kill → restart → byte-offset resume acceptance is NOT VERIFIED.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED in this environment.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Physical power-loss acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.

## Next prioritized batch

Add a process-level receiver integration harness around the legacy whole-file compatibility route to prove authenticated member audit rows, pair-code/challenge compatibility metadata, duplicate behavior and fail-before-side-effect binding rejection through the real HTTP boundary. Then define a measurable deprecation gate for the whole-file route based on physical-device resumable acceptance and compatibility telemetry, rather than removing it prematurely.
