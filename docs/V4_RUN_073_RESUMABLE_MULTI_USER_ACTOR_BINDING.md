# V4 Run 073 — Resumable Multi-User Actor Binding

## Starting point

This run continued from `v4` after the relay resumable wiring batch. The production resumable protocol was already workspace/device scoped, but authenticated user identity was not durably bound to the upload session. The production post-commit audit path could therefore attribute a resumable ingest to the legacy workspace owner instead of the member who actually created the upload.

`v3` is intentionally untouched.

## Implemented

### Durable authenticated actor binding

Resumable session metadata now supports version 2 and persists `actorUserId` alongside workspace/device identity. Production creates version-2 sessions because `createResumableMediaProductionRuntime()` now requires an authenticated bearer principal with all three authoritative bindings:

- `subject` → `actorUserId`
- `workspaceId`
- `deviceId`

Missing subject, workspace, or device fails closed before session creation.

Legacy version-1 session records remain readable for compatibility with uploads already present on disk during upgrade. New production sessions are not created without actor identity.

### Cross-member isolation

Status, chunk append, completion, and finalize now bind the request to the persisted actor whenever the session has actor identity. A different member cannot take over a session merely by presenting a valid token for the same workspace and device.

The HTTP security contract treats this as authenticated-but-forbidden and returns `403 FORBIDDEN` rather than exposing internal binding details.

### Restart durability

Actor identity is persisted in the same durable session metadata as authoritative acknowledged byte offset. Regression coverage recreates the store from disk and proves that the original member can resume while another member on the same workspace/device remains rejected.

### Finalize reconciliation identity

The durable finalize ledger also supports version 2 with `actorUserId`. Actor binding therefore survives the failure window where media commit has completed but quota commit/reconciliation still needs to finish after restart.

Version-1 finalize records remain readable for upgrade compatibility. Version-2 records require actor identity, and idempotency/conflict checks include actor identity.

### Production commit and audit attribution

The verified production commit result now carries `actorUserId` from the durable upload session. `main.ts` uses that actor for the resumable `media.ingest` audit record instead of `LEGACY_OWNER_USER_ID`.

Post-commit notifications, video processing, and replica scheduling remain unchanged.

The legacy whole-file compatibility route is intentionally left behavior-compatible in this batch; its owner-compatible audit attribution is now an explicit remaining migration item rather than being mixed into the resumable path.

## Regression coverage

Added/updated coverage verifies:

- production requires authenticated user subject in addition to workspace/device;
- post-commit receives the authenticated actor;
- a different member on the same workspace/device receives `403 FORBIDDEN` for another member's resumable session;
- actor binding survives durable store restart;
- production commit fixtures use actor-bound version-2 sessions;
- version-1 finalize record shape remains backward compatible;
- existing quota reconciliation, restart resume, SHA-256 finalize, duplicate protection, shared ingest coordination, relay resumable behavior, Google Drive allocation, Google Photos migration, Web security, Range streaming, and repository suites continue through the repository gate.

## Priority requirements carried forward

1. Google Drive allocation remains non-fixed. Default PhotoX allocation is `2/3` of each account's authoritative total Google storage quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API: only Picker-selected source media, append-only Google Photos destination uploads or connected Google Drive destination, durable ledger/progress/pause/resume/retry/verification/account selection, and no claim of unrestricted full-library crawling.
3. Web continues to use the shared Desktop React UI/components/styles and `DesktopBridge` contract, with Electron IPC plus authenticated HTTP/WebSocket adapters, configurable exposure/reverse proxy behavior, Range streaming, workspace/session auth, roles, CORS/CSRF/rate limiting, and audit controls.

## Remaining risks / not yet verified

- Legacy whole-file bearer/pair compatibility upload still has legacy-owner-compatible audit attribution and should be migrated/deprecated safely after resumable rollout is established.
- Physical Android/iOS network-loss → process-kill → restart → byte-offset resume acceptance is NOT VERIFIED.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED in this environment.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Physical power-loss acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.
- Current CI install reports an existing dependency audit backlog; dependency remediation should be handled separately with compatibility review rather than an unsafe blanket forced upgrade.

## Next prioritized batch

Harden the remaining legacy whole-file compatibility boundary without weakening rollout compatibility: derive actor identity for bearer whole-file uploads, separate pair-code legacy attribution explicitly, add audit/isolation regressions, and define the safe deprecation gate for whole-file upload once resumable physical-device acceptance is complete. Then continue broader SaaS hardening from the highest incomplete production-risk item.