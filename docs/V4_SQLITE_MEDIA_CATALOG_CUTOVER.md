# PhotoX V4 — SQLite Media Catalog Cutover

## Purpose
Move the Desktop/Web media catalog from `media-index.json` to transactional SQLite without dual-writing, without changing runtime semantic operations, and without weakening workspace isolation, deletion tombstones, replica state, ingest crash recovery, or rollback safety.

## Completed foundation
- `SqliteMediaIndexCatalog` owns a composite `workspace_id + media_key` primary key, schema version metadata, transactional append/patch/remove, exact identity immutability, workspace listing/all listing, and JSON row preservation for existing video/replica/deletion metadata.
- Legacy JSON import is strict and idempotent. It validates row identities and duplicates, requires an empty SQLite target, stores the source SHA-256 in a versioned migration marker, creates/fsyncs a backup artifact before import, rejects a changed source after import, and commits rows + marker in one SQLite transaction.
- SQLite can export the active catalog back to atomic JSON for operator rollback/recovery.
- Desktop `mediaIndexRuntimeWriter` accepts either the legacy JSON path or an injected `MediaIndexMutationRepository`. This keeps ingest/video/replica/delete semantics storage-agnostic and avoids a JSON+SQLite dual-write mode.
- `mediaIndexSqliteRepository.ts` adapts `SqliteMediaIndexCatalog` to the existing async exact-identity mutation repository contract.
- CI-gated Desktop regressions verify SQLite runtime semantics for identical media keys in different workspaces, video patch isolation, concurrent Drive replica progress, deletion tombstone blocking, owner-only deletion finalization, duplicate ingest fail-closed behavior, and identity immutability.
- `mediaCatalogBackend.ts` provides the Desktop/Web startup authority boundary. It opens the PhotoX SQLite store, performs the one-time legacy import, validates catalog identities, migration marker version/SHA, and the marker's imported-row lower bound before returning any runtime read/write handle. A first install with no legacy JSON is supported. Post-migration SQLite growth is allowed while a catalog with fewer rows than its durable import marker fails closed.
- Startup backend regressions cover first import, already-imported restart with post-cutover rows, source mutation after import, first install without legacy JSON, and fail-closed detection when imported data disappears.
- Desktop production startup now prepares legacy workspace IDs only before the one-time import, opens exactly one `ActiveMediaCatalogBackend`, and activates it before ingest crash recovery, workspace usage bootstrap, receiver/Web startup, deletion replay, video processing, or Drive retry work.
- Desktop runtime reads now use SQLite `listAll`/`listWorkspace`; ingest/video/replica/delete mutations use the active backend writer. Ingest journal recovery and deletion tombstone replay therefore consult the same SQLite authority as normal runtime operations rather than stale JSON.
- Desktop shutdown closes the active media catalog store. Production wiring regressions fail if the legacy JSON runtime writer is reintroduced or if recovery runs before SQLite activation.

## Active cutover work
1. Surface catalog health/observability beyond the startup log: backend kind, schema version, migration status, active row count, imported row count, backup path, source SHA, and startup validation failure reason in operations/admin diagnostics without leaking filesystem details to unauthorized Web users.
2. Add restart/crash-boundary integration regressions around the production lifecycle: interrupted legacy workspace-ID preparation, crash before import transaction, crash after import commit before runtime activation, already-imported restart, source changed after marker, missing legacy JSON on first install, and corrupt/too-new SQLite fail-closed behavior.
3. Add explicit operator rollback/export tooling around the existing atomic SQLite-to-JSON export and document when the preserved pre-cutover backup may be used. Runtime must remain SQLite-only; rollback is an offline/operator action, never dual-write.
4. After restart/crash acceptance is green, stop referring to `media-index.json` as a runtime catalog anywhere in product/operator documentation. Keep it only as the one-time legacy import source and preserved rollback artifact.

## Non-negotiable product constraints carried through cutover
- Google Drive allocation has no fixed 10 GB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota while respecting provider remaining bytes, safety reserve, and configurable per-account ratio.
- Google Photos migration remains Picker-selected only under the current Google Photos Picker API, with append-only destination upload and durable migration state. The product must not claim unrestricted full-library crawling.
- Web and Desktop continue to share the same React UI/components/styles and `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters respectively.
- Workspace/tenant identity must remain authoritative at every catalog operation; identical media keys in different workspaces must never collide.

## Exit criteria for SQLite authority
SQLite is now the sole active Desktop media catalog at the production lifecycle boundary. Release acceptance still requires repository tests, Desktop integration tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging, and packaged Desktop smoke to remain green on the final branch head. Platform-signed installers and real process-kill/power-loss acceptance remain separately reportable as NOT VERIFIED until run in the required platform/signing environment.
