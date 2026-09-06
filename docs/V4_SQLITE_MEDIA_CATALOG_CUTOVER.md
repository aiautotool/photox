# PhotoX V4 — SQLite Media Catalog Cutover

## Purpose
Move the Desktop/Web media catalog from `media-index.json` to transactional SQLite without dual-writing, without changing runtime semantic operations, and without weakening workspace isolation, deletion tombstones, replica state, ingest crash recovery, or rollback safety.

## Completed foundation
- `SqliteMediaIndexCatalog` owns a composite `workspace_id + media_key` primary key, schema version metadata, transactional append/patch/remove, exact identity immutability, workspace listing/all listing, and JSON row preservation for existing video/replica/deletion metadata.
- Legacy JSON import is strict and idempotent. It validates row identities and duplicates, requires an empty SQLite target, stores the source SHA-256 in a versioned migration marker, creates/fsyncs a read-only-style backup artifact before import, rejects a changed source after import, and commits rows + marker in one SQLite transaction.
- SQLite can export the active catalog back to atomic JSON for operator rollback/recovery.
- Desktop `mediaIndexRuntimeWriter` accepts either the legacy JSON path or an injected `MediaIndexMutationRepository`. This keeps ingest/video/replica/delete semantics storage-agnostic and avoids a JSON+SQLite dual-write mode.
- `mediaIndexSqliteRepository.ts` adapts `SqliteMediaIndexCatalog` to the existing async exact-identity mutation repository contract.
- CI-gated Desktop regressions verify SQLite runtime semantics for identical media keys in different workspaces, video patch isolation, concurrent Drive replica progress, deletion tombstone blocking, owner-only deletion finalization, duplicate ingest fail-closed behavior, and identity immutability.
- `mediaCatalogBackend.ts` now provides the Desktop/Web startup authority boundary. It opens the PhotoX SQLite store, performs the one-time legacy import, validates catalog identities, migration marker version/SHA, and the marker's imported-row lower bound before returning any runtime read/write handle. A first install with no legacy JSON is supported. Post-migration SQLite growth is allowed while a catalog with fewer rows than its durable import marker fails closed.
- Startup backend regressions cover first import, already-imported restart with post-cutover rows, source mutation after import, first install without legacy JSON, and fail-closed detection when imported data disappears.

## Active cutover work
1. Wire the Desktop process startup to create exactly one `ActiveMediaCatalogBackend` and keep it alive for the process lifetime; close it during app shutdown.
2. Route `readIndex`/strict startup reads through the active backend so read authority switches at the same boundary as writes. Do not leave JSON reads active after SQLite becomes authoritative.
3. Instantiate production `mediaIndexRuntimeWriter` from `backend.writer`; keep the legacy JSON factory only for explicit rollback/migration tooling and tests.
4. Route ingest journal recovery and deletion tombstone replay through the active catalog backend so crash recovery never consults stale JSON after cutover.
5. Surface backend health/observability from the authority boundary: backend kind, schema version, migration status, active row count, imported row count, backup path, source SHA, and startup validation failure reason.
6. Add restart/crash-boundary regressions around production startup wiring: crash before import transaction, crash after import commit before runtime activation, already-imported restart, source changed after marker, missing legacy JSON on first install, and corrupt/too-new SQLite fail-closed behavior.
7. Only after these gates are green, stop treating `media-index.json` as an active runtime catalog. Retain the backup/export artifact for operator rollback according to release policy.

## Non-negotiable product constraints carried through cutover
- Google Drive allocation has no fixed 10 GB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota while respecting provider remaining bytes, safety reserve, and configurable per-account ratio.
- Google Photos migration remains Picker-selected only under the current Google Photos Picker API, with append-only destination upload and durable migration state. The product must not claim unrestricted full-library crawling.
- Web and Desktop continue to share the same React UI/components/styles and `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters respectively.
- Workspace/tenant identity must remain authoritative at every catalog operation; identical media keys in different workspaces must never collide.

## Exit criteria for SQLite authority
SQLite becomes the sole active media catalog only when repository tests, Desktop integration tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging, and packaged Desktop smoke are green with the startup orchestrator wired into production reads, writes, ingest recovery, and deletion replay. Platform-signed installers and real process-kill/power-loss acceptance remain separately reportable as NOT VERIFIED until run in the required platform/signing environment.
