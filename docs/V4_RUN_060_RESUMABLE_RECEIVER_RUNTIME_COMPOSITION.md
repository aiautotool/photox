# V4 Run 060 — Resumable receiver runtime composition

## Why this batch

The resumable upload foundation already had a durable session store, server-authoritative offsets, SHA-256 finalization, durable quota reservation ownership, and authenticated `create/status/chunk/finalize` HTTP routing. The remaining production gap was composition: those pieces still existed as independently tested modules while `main.ts` continued to serve the legacy whole-file `POST /api/v1/media` path.

This batch reduces that integration risk without creating a second receiver or parallel media authority. It introduces one production-shaped runtime composition boundary that owns resumable session state, lifecycle, HTTP handling, and expiry cleanup while leaving workspace authorization and final media commit authority injectable from the existing Desktop receiver.

## Implemented

- Added `desktop/electron/resumableMediaReceiverRuntime.ts`.
- The runtime composes the existing durable `ResumableMediaIngestStore`, `createResumableMediaIngestLifecycle`, and authenticated `createResumableMediaIngestHttpHandler` instead of duplicating their behavior.
- Application-specific authorization is injected, so the production mount can use the existing workspace/session auth and require `media:write` rather than trusting request payload identity.
- Application-specific `exists` and `commit` callbacks are injected, so the production mount can reuse the existing SQLite catalog, ingest recovery journal, post-ingest processing, and provider scheduling path rather than introducing another catalog authority.
- Durable quota hooks remain required by the runtime; resumable sessions therefore cannot accidentally be composed without reservation ownership.
- Added periodic expired-session cleanup with a 15-minute default cadence, explicit start/stop lifecycle, timer `unref`, and single-flight cleanup so overlapping timer/manual cleanup cannot double-release reservations.
- Session TTL, cleanup cadence, JSON limit and chunk limit remain configurable at the runtime boundary.
- Added node:test regression coverage for real HTTP create/chunk/status/finalize across a runtime restart, durable authoritative byte offset recovery, verified final commit, quota commit ordering, expired-session quota release, cleanup single-flight behavior, and invalid runtime limits.
- Added the new runtime and regression suite to `desktop/tsconfig.electron-test.json`, so repository CI compiles and executes them.

## P0 invariants carried forward

- Google Drive allocation has no fixed 10 GiB PhotoX cap. The default per-account ratio remains 2/3 of authoritative Google total quota, additionally bounded by authoritative remaining provider bytes and configured safety reserve; ratio is configurable per account.
- Google Photos migration remains Picker-selected only. PhotoX must not advertise unrestricted full-library crawling. Destination Google Photos writes remain append-only; Google Drive remains the alternate supported destination with durable migration state.
- Desktop and Web continue to share the same React UI/components/styles through `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters and the existing public-Web security boundaries.

## Validation

Repository CI run 902 on code HEAD `7c0f265512be685b0a16d37d3f29cfdad30004a2` passed install, repository tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging, and packaged Desktop smoke.

## Still incomplete

- The composed resumable runtime is not yet mounted inside production `startReceiver()`. Mobile upload must therefore still not be described as server-authoritative byte-offset resumable in production.
- The final production `commit` adapter still needs to hand the verified resumable `.part` through the existing ingest recovery journal, SQLite catalog ingest, renderer/Web notifications, video processing, and cloud replica scheduling path.
- Mobile still needs a durable client upload-session ledger, server-status reconciliation after restart/network loss, chunk reads from acknowledged offset, and finalize/retry behavior.
- Live Google Drive/Google Photos provider acceptance, real TLS reverse-proxy/WebSocket/Range acceptance, physical-device background execution, and signed release artifacts remain external acceptance items.

## Next batch

Mount `createResumableMediaReceiverRuntime()` into the existing Desktop receiver with `media:write` workspace authorization, `createWorkspaceResumableQuotaHooks(requireWorkspaceRepository())`, and a shared final media commit adapter that reuses the current ingest recovery/SQLite/video/cloud path. Start and stop expiry cleanup with the app lifecycle and add receiver-composition integration coverage. Only after that server path is green should mobile switch from whole-file transport to durable session IDs and resume from server-confirmed `acknowledgedBytes`.
