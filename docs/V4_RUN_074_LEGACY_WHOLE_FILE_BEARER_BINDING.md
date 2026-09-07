# V4 Run 074 — Legacy Whole-File Bearer Binding Hardening

## Starting point

This run continued from the latest `v4` state after Run 073. Resumable uploads already durably bind authenticated `actorUserId`, workspace, and device identity across restart/finalize reconciliation. The remaining compatibility route `POST /api/v1/media` still supports whole-file upload and therefore remains part of the safe rollout boundary.

`v3` is intentionally untouched.

## Analysis

The legacy whole-file route authorizes bearer access tokens with `media:write`, but the compatibility request also carries `x-photosync-workspace-id` and `x-photosync-device-id`. Before this run, those headers were not checked against the authenticated token principal by `DesktopWorkspaceAuth.authorizeRequest()`.

That created an avoidable identity ambiguity at the legacy boundary: authorization itself was token-backed, while compatibility metadata could name a different workspace/device. This needed to be closed before changing whole-file audit attribution from legacy-owner compatibility identity to the authenticated member.

## Implemented

### Bearer request binding guard

Added `assertBearerRequestBinding()` in `desktop/electron/workspaceAuth.ts` and applied it to `authorizeRequest()` after authoritative token/member/device validation.

For bearer-authenticated requests:

- if `x-photosync-workspace-id` is present, it must equal the token principal workspace;
- if `x-photosync-device-id` is present, it must equal the token principal device;
- a mismatch fails closed before endpoint logic executes;
- endpoints that do not use these legacy compatibility headers remain valid because absent headers are not required by this generic guard.

This protects the legacy whole-file upload path and other bearer endpoints that still carry compatibility headers without weakening the resumable protocol, which already binds identity through its own durable session contract.

### Regression coverage

Added `desktop/electron/workspaceAuthBinding.test.ts` covering:

- matching workspace/device headers;
- workspace-header spoof rejection;
- device-header spoof rejection;
- requests with no legacy compatibility headers.

The test is included by the existing Desktop test glob and therefore participates in the repository CI gate.

## Validation

Code HEAD `29c8fb6537781dec37acc56aef01a9cb7717dd38` passed GitHub Actions CI run 984 (`34142626584`):

- dependency install — PASS;
- repository tests — PASS;
- TypeScript typecheck — PASS;
- production build — PASS;
- built Desktop renderer smoke — PASS;
- electron-builder package — PASS;
- packaged Desktop application smoke — PASS.

Local clone/test/build remains NOT VERIFIED in the automation execution environment because `github.com` DNS resolution is unavailable there; GitHub Actions is the authoritative executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation remains non-fixed. Default PhotoX allocation is `2/3` of each account's authoritative total Google storage quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API: Picker-selected source media only, append-only Google Photos destination uploads or connected Google Drive destination, durable ledger/progress/pause/resume/retry/verification/account selection, and no claim of unrestricted full-library crawling.
3. Web continues to use the shared Desktop React UI/components/styles and `DesktopBridge` contract with Electron IPC plus authenticated HTTP/WebSocket adapters, configurable host/port/domain/reverse-proxy exposure, Range streaming, workspace/session auth, role enforcement, CORS/CSRF/rate limiting, and audit controls.

## Remaining risks / not yet verified

- Whole-file bearer uploads still need the final audit-attribution change so `media.ingest` records use the authenticated member subject instead of legacy owner compatibility identity.
- Pair-code/challenge whole-file uploads cannot truthfully identify a SaaS member; their audit metadata must explicitly remain legacy compatibility attribution rather than pretending to know a member identity.
- Physical Android/iOS network-loss → process-kill → restart → byte-offset resume acceptance is NOT VERIFIED.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED in this environment.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Physical power-loss acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.
- Existing dependency-audit backlog should be remediated separately with compatibility review rather than blanket forced upgrades.

## Next prioritized batch

Complete legacy whole-file attribution safely: carry the already-authorized bearer principal into `receiveMedia()`, use `principal.subject` and authoritative token device for bearer `media.ingest` audit records, explicitly mark pair-code/challenge uploads as legacy compatibility attribution, and add runtime-level audit/isolation regressions. Keep whole-file upload only as a compatibility route until physical-device resumable acceptance is complete, then define and enforce its deprecation gate.
