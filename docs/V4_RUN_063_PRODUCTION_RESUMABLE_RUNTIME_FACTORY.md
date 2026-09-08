# V4 Run 063 — Production resumable runtime factory

## Scope completed

This batch continued from the existing durable resumable ingest work without restarting or changing `v3`.

Added `desktop/electron/resumableMediaProductionRuntime.ts`, a production composition boundary that wires the already-completed resumable upload protocol to the real PhotoX authorities:

- bearer authorization must resolve an authenticated workspace and device and is always requested with `media:write`;
- workspace quota reservations use the durable workspace repository through `createWorkspaceResumableQuotaHooks`;
- final verified bytes use `createResumableMediaProductionCommit`, the ingest recovery journal, and the authoritative catalog ingest callback;
- the caller must inject the process-wide `mediaIngestCommitCoordinator`, so legacy whole-file and resumable finalization can serialize on the same `(workspaceId, mediaKey)` boundary;
- post-commit work stays retryable and outside the durable local-media transaction;
- the factory does not create another HTTP server. The existing Desktop receiver remains the single listener and will delegate only `/api/v1/media/uploads*` requests to this runtime.

Added HTTP-backed regression coverage for:

- `media:write` authorization on create/chunk/finalize;
- workspace/device principal binding;
- durable quota reservation commit;
- verified local copy and catalog ingest;
- post-commit callback execution;
- fail-closed behavior for an authenticated principal without a device binding;
- public auth errors remaining sanitized as `UNAUTHORIZED` instead of leaking internal binding details.

The new production composition regression is included in `desktop/tsconfig.electron-test.json`, so repository `npm test` executes it.

## Validation

GitHub Actions CI run 922 (`34093381272`) on code HEAD `21608db0966684a34b246125911958a1b337e594` passed:

- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop application smoke: PASS

A first gated run correctly failed because the new negative-auth regression expected an internal error string. The HTTP transport intentionally sanitizes authentication failures. The regression was corrected to assert the public `{ error: "UNAUTHORIZED" }` contract and the complete gate was rerun green.

Local git clone/build remains NOT VERIFIED in this execution environment because DNS resolution for `github.com` is unavailable; GitHub Actions is the authoritative validation path for this batch.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and a safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only and append-only destination upload (or connected Google Drive destination), with durable ledger/progress/pause/resume/retry/verification/account selection. Do not advertise unrestricted full-library crawling.
3. Web remains the same React UI/components/styles as Desktop through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming, workspace/session auth, roles, CORS/CSRF/rate-limit/audit hardening.

## Remaining production gap / next batch

The production factory is now ready, but `main.ts::startReceiver()` still has not delegated `/api/v1/media/uploads*` to it. The next batch should make the smallest possible receiver change:

1. instantiate this factory after workspace auth, workspace repository, catalog and filesystem roots are ready;
2. delegate resumable upload routes before the receiver's legacy auth/path dispatch;
3. start/stop expiry cleanup with app lifecycle;
4. wire `exists` to the authoritative workspace catalog;
5. wire `ingest` to `mediaIndexWriter().ingest` and post-commit notification/video/Drive-replica queue behavior;
6. retain legacy whole-file `POST /api/v1/media` during mobile migration;
7. add receiver-composition integration coverage;
8. only then migrate mobile to persist `sessionId`, query server `acknowledgedBytes`, and resume from the server-owned offset.

Signed iOS/Android artifacts, signed Windows/macOS installers, live Google Drive/Google Photos acceptance, physical power-loss acceptance, real public TLS/reverse-proxy/WebSocket/Range deployment, and Stripe live E2E remain NOT VERIFIED.
