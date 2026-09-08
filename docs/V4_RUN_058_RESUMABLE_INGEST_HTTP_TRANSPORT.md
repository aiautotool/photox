# V4 Run 058 — Authenticated resumable ingest HTTP transport

## Scope completed

This batch advances the server-authoritative resumable upload path from lifecycle-only code to a concrete HTTP transport contract.

`desktop/electron/resumableMediaIngestHttp.ts` now implements an isolated receiver router for:

- `POST /api/v1/media/uploads` — create a durable upload session;
- `GET /api/v1/media/uploads/:sessionId` — return the server-authoritative acknowledged offset;
- `PATCH /api/v1/media/uploads/:sessionId/chunks` — append the next ordered chunk;
- `POST /api/v1/media/uploads/:sessionId/finalize` — finalize through the existing lifecycle after whole-file verification.

Security and correctness rules are explicit:

- every resumable endpoint requires an authenticated principal supplied by the receiver auth layer;
- workspace and device identity are never accepted from request JSON, preventing tenant/device spoofing;
- JSON and binary bodies are size-bounded while streaming;
- chunk requests require an integer `x-photox-upload-offset`;
- stale/skipped offsets return HTTP 409 with the authoritative `acknowledgedBytes`, giving mobile a deterministic resynchronization point;
- missing sessions return 404, expired sessions 410, binding mismatch 403, oversized bodies/chunks 413, and incomplete/hash-conflict finalize operations 409;
- response payloads expose resumable progress metadata only and do not leak filesystem paths, quota reservation IDs, or internal recovery metadata;
- unrelated receiver routes are left untouched by the router.

The new transport has real HTTP regression tests using a temporary Node HTTP server rather than only calling helper functions directly. The tests cover authentication, body identity spoofing resistance, server-owned progress, stale offset recovery, strict chunk limits, status/finalize behavior, and route non-interference. The files are included in `desktop/tsconfig.electron-test.json`, so repository `npm test` gates them.

## Validation

CI run 896 on code HEAD `452cf17ed52126002841984fe6bf2407c4520142` passed:

- repository tests;
- TypeScript typecheck;
- production build;
- built Desktop renderer smoke;
- electron-builder Linux package directory;
- packaged Desktop application smoke.

Direct local clone/build remains unavailable in the current execution environment because `github.com` cannot be resolved from the container, so GitHub Actions is the authoritative validation for this batch.

## Priority requirements carried forward

1. Google Drive allocation remains **not a fixed 10 GiB cap**. Default PhotoX allocation is `2/3` of each account's authoritative total quota, constrained by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains **Picker-selected only** using the current Picker API, with append-only destination upload and no claim of unrestricted full-library crawling.
3. Desktop and Web continue to share the same React UI/components/styles and `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters.

## Not complete yet

The router is production-shaped and tested, but `main.ts` has not yet mounted it into `startReceiver()`. Therefore the public receiver still exposes the existing whole-file `POST /api/v1/media` path and mobile must not yet claim byte-offset resumability.

The remaining server integration must instantiate `ResumableMediaIngestStore`, `createWorkspaceResumableQuotaHooks`, and `createResumableMediaIngestLifecycle` against the real workspace repository and media commit path, then delegate matching requests to this router before the legacy route dispatcher.

## Next prioritized batch

Mount the resumable router in the real receiver and wire lifecycle commit to the existing ingest recovery journal + SQLite media catalog commit path. Add expiry cleanup scheduling and integration coverage proving authenticated create/status/chunk/finalize works through the real receiver composition. Once that is green, update mobile to persist `sessionId`, query `acknowledgedBytes` after restart/network loss, and send only bytes after the server-confirmed boundary.
