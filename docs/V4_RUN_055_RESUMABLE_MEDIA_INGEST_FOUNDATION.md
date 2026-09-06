# V4 Run 055 — Resumable media ingest foundation

## Scope completed

This batch starts the production resumable-upload path without pretending the existing whole-file mobile upload is resumable.

Desktop now has a durable `ResumableMediaIngestStore` foundation with server-authoritative upload sessions. Each session persists:

- opaque server-generated session ID;
- workspace, device, and asset binding;
- filename, MIME/media type, capture timestamp, and exact expected byte count;
- durable acknowledged byte offset;
- creation/update timestamps and server expiry deadline;
- a `.part` payload whose durable file size must exactly match the persisted acknowledged offset.

Chunk acceptance is strictly ordered. A chunk is rejected when the caller supplies a stale/skipped offset, exceeds the configured chunk ceiling, crosses the declared total size, uses another workspace/device binding, or references expired/corrupt state. The part file is fsynced before acknowledged metadata advances. Metadata updates are written through a temporary file and atomically renamed. If metadata advancement fails after a chunk write, the part file is truncated back to the previous acknowledged boundary.

CI regressions cover restart/resume from the server-owned offset, strict ordering, chunk-size and total-size bounds, tenant/device binding, incomplete-finalization refusal, metadata/part divergence fail-closed behavior, and expiry cleanup.

## Important boundary

The current `POST /api/v1/media` whole-file endpoint and Expo `createUploadTask` flow remain unchanged in this batch. Client-side `totalBytesSent` is still transport progress only and MUST NOT be presented as a resumable acknowledged offset.

Production resumability is complete only after the receiver exposes authenticated create/status/chunk/finalize endpoints backed by this store, finalization feeds the existing media-ingest commit coordinator and quota reservation lifecycle, and mobile persists the session ID and resumes from the offset returned by Desktop after app/network restart.

## Priority requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains two thirds of the account's authoritative total quota, bounded by real provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only and append-only to a destination Google Photos account (or transfer to connected Drive), with durable ledger/progress/pause/resume/retry/verification. PhotoX must not claim unrestricted full-library crawling.
3. Web and Desktop remain one shared React UI/component/style surface through `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters plus workspace/session auth, roles, CORS/CSRF/rate limiting/audit and Range streaming for public exposure.

## Next prioritized batch

Wire the durable store into Desktop receiver endpoints with workspace/device authorization, quota reservation ownership, idempotent create/status, bounded binary chunk ingestion, final whole-file verification and atomic handoff into the existing ingest commit path. Then update mobile to persist session state and report only server-acknowledged resumable progress.

## Validation status

Repository CI is the authoritative validation in this environment because direct `git clone` cannot resolve `github.com`. Signed iOS/Android artifacts, signed Windows/macOS installers, physical power-loss acceptance, live Google provider acceptance, and real TLS/reverse-proxy deployment remain NOT VERIFIED until run in their required environments.
