# V4 Run 064 — Production resumable receiver wiring

## Scope completed

This batch continued directly from V4 Run 063 and mounted the already-tested production resumable runtime into the real Desktop receiver without changing `v3` or replacing the legacy receiver.

Production `main.ts::startReceiver()` now:

- creates `createResumableMediaProductionRuntime()` only after workspace auth, workspace repository, media catalog and filesystem authorities are initialized;
- delegates `/api/v1/media/uploads*` to the resumable runtime before the legacy pairing/scope/path dispatcher, so resumable requests are authenticated by the runtime with `media:write` and cannot downgrade into legacy route handling;
- uses the existing process-wide `mediaIngestCommitCoordinator`, so legacy whole-file uploads and resumable finalization serialize on the same `(workspaceId, mediaKey)` boundary while both transports coexist;
- uses workspace-backed durable quota reservations and the authoritative media catalog;
- finalizes through the ingest recovery journal and verified production commit adapter;
- publishes the existing file-received notification, starts video processing when applicable, queues Google Drive replica work, and appends a media-ingest audit record after a local commit;
- starts resumable expiry cleanup with the receiver lifecycle and stops it during application shutdown;
- intentionally retains legacy `POST /api/v1/media` for compatibility while mobile is migrated.

## Hardening found during review

The first wiring review exposed two production-boundary issues and both were fixed before marking the batch complete.

1. The resumable store root supplied by Desktop was outside the recovery journal's managed `incomingRoot`. The production factory now normalizes any unsafe durable root to `<incomingRoot>/resumable`; explicit roots already inside the managed incoming boundary remain unchanged. This preserves the journal's fail-closed path-containment invariant instead of weakening recovery validation.
2. The resumable HTTP handler now owns the entire `/api/v1/media/uploads*` namespace. Unsupported methods or child paths return a resumable 404 directly and cannot fall through to legacy `/api/v1/media/:key` dispatch.

Regression coverage was extended for both cases: an unsafe configured root is normalized and still completes a verified upload, and unsupported resumable namespace routes are rejected without lifecycle mutation or legacy fallback.

## Validation

GitHub Actions CI run 928 (`34098452048`) on code HEAD `8bb2f8a0af0a2d4b2b968dd1879fef60f3b2dbb1` passed the complete repository gate:

- npm install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Desktop package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED in this execution environment because DNS resolution for `github.com` is unavailable; GitHub Actions is the authoritative validation path for this batch.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and a safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only and append-only destination upload (or connected Google Drive destination), with durable ledger/progress/pause/resume/retry/verification/account selection. Never advertise unrestricted full-library crawling.
3. Web remains the same React UI/components/styles as Desktop through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session auth, role enforcement, CORS/CSRF/rate-limit/audit hardening.

## Remaining production gaps / next batch

The Desktop server now exposes the production-shaped resumable transport, but the mobile client still uses the legacy whole-file upload path. End-to-end mobile byte-offset resume is therefore NOT COMPLETE yet.

Next priority:

1. add a durable mobile upload-session ledger keyed by the mobile media identity;
2. create a resumable session and persist `sessionId`, declared size/hash metadata and server endpoint identity;
3. on retry/app restart/network loss, query server status and trust the server-owned `acknowledgedBytes` rather than a local guessed offset;
4. stream bounded chunks from the acknowledged offset, handle 409 offset reconciliation, expiry/session recreation and access-token refresh;
5. finalize with SHA-256 and only mark the existing mobile sync ledger successful after the server returns committed/already-received semantics;
6. retain a controlled compatibility fallback to legacy whole-file upload only where server capability discovery requires it, then remove that fallback after rollout acceptance;
7. add mobile unit/integration coverage for restart, stale offset, expired session, auth refresh, duplicate finalization and policy-disabled backup.

A residual multi-tenant audit attribution hardening item remains: the resumable post-commit callback currently records the authenticated device but still uses the legacy owner user identifier in `main.ts`. Before multi-user workspace rollout, actor user identity should be carried durably with the upload session or resolved authoritatively from the workspace device membership rather than relying on the legacy-owner compatibility identity.

Signed iOS/Android artifacts, signed Windows/macOS installers, live Google Drive/Google Photos acceptance, physical power-loss acceptance, real public TLS/reverse-proxy/WebSocket/Range deployment, and Stripe live E2E remain NOT VERIFIED.