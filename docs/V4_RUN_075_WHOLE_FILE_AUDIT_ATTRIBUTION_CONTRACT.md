# V4 Run 075 — Whole-File Audit Attribution Contract

## Starting point

This run continued from the latest `v4` state after Run 074. The legacy whole-file route already rejects bearer workspace/device header spoofing, while the resumable path already carries durable authenticated actor identity through finalize and post-commit audit.

`v3` is intentionally untouched.

## Analysis

The remaining whole-file gap is audit attribution. `POST /api/v1/media` still records `media.ingest` with the legacy owner compatibility identity even when the request is authenticated by a workspace member bearer token.

Pair-code and pairing-challenge compatibility uploads are different: they do not truthfully prove a SaaS member identity and therefore must stay visibly classified as compatibility attribution rather than being silently rewritten as a workspace member.

Before wiring this into the large production receiver, this run established one fail-closed attribution contract that the route can consume without duplicating identity rules.

## Implemented

Added `desktop/electron/legacyMediaAuditAttribution.ts`.

The contract has two explicit modes:

- bearer: requires authoritative workspace and device binding, records the authenticated `subject` and token device, and classifies audit metadata as `authenticated-member`;
- pair-code / pairing-challenge: keeps legacy owner/device attribution and explicitly classifies audit metadata as `legacy-compatibility`.

Bearer attribution fails closed when workspace binding, device binding, or actor identity is missing. Session ID and workspace role are preserved in bearer audit metadata when available.

Added `desktop/electron/legacyMediaAuditAttribution.test.ts` covering authenticated member attribution, workspace mismatch rejection, device mismatch rejection, pair-code compatibility attribution, and pairing-challenge compatibility attribution.

## Validation

Code HEAD `cc2cf2c7bf775471105359a9180724ef816f34c6` passed GitHub Actions CI run 987 (`34145141482`):

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

- The new attribution contract is not yet consumed by `main.ts::receiveMedia()`. Production whole-file bearer audit therefore still uses the legacy owner identity until the next wiring batch; do not mark this gap production-ready yet.
- Runtime-level whole-file audit regressions still need to prove bearer member attribution and compatibility-mode metadata through the real receiver path.
- Physical Android/iOS network-loss → process-kill → restart → byte-offset resume acceptance is NOT VERIFIED.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED in this environment.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Physical power-loss acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.

## Next prioritized batch

Wire `legacyWholeFileAuditAttribution()` into `receiveMedia()`: carry the already-authorized bearer principal into the whole-file ingest path, use authoritative token member/device attribution for bearer audit, classify pair-code/challenge records as legacy compatibility, and add runtime-level receiver regressions. After physical-device resumable acceptance, define and enforce the whole-file deprecation gate.
