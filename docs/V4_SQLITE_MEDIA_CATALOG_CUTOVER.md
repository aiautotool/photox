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
- Restart-boundary regressions cover a durable pre-import backup with no marker, process restart after import commit but before runtime backend activation, corrupt SQLite fail-closed behavior, and newer-than-supported media catalog schema rejection. These complement the existing already-imported/source-changed/fresh-install/data-loss guards.
- `mediaCatalogDiagnostics.ts` defines a role-safe diagnostics contract. Workspace-visible diagnostics expose backend/schema/migration/count/backup-availability only; trusted operator diagnostics may additionally expose the local backup path and source SHA-256. Tests prevent filesystem paths or source fingerprints from leaking through the workspace-safe shape.
- Catalog health is live rather than a startup snapshot: `rowCount` is read from current SQLite authority after ingest/delete, preventing stale Admin/Operations diagnostics.
- `mediaCatalogOperationsTransport.ts` defines the transport policy boundary. Web diagnostics require `admin`/`owner` and always return the workspace-safe redacted shape even for owners; only the trusted local Desktop/operator boundary may expose backup path and source SHA-256.
- Production transports expose authenticated Web `GET /api/web/v1/operations/media-catalog` and trusted Desktop IPC/preload diagnostics through the shared `DesktopBridge` contract.
- Desktop runtime and offline operator recovery tools share an exclusive process authority lease (`<sqlite>.authority.lock`). Live Desktop ownership blocks export/restore, offline operator ownership blocks Desktop startup, malformed locks fail closed, and stale crash locks are reclaimed only when the recorded PID is proven absent.
- CI now includes a real child-process authority-holder termination regression: a live `operator-restore` process blocks Desktop authority, abrupt process termination leaves the expected stale lease, and the next process reclaims it only after the old PID is gone.
- Offline restore regressions are explicitly part of `tsconfig.electron-test.json`; successful restore, Desktop-authority blocking, SHA verification, duplicate tenant identity rejection, corrupt SQLite handling, and lease release on open failure are no longer orphaned tests outside the repository gate.
- `mediaCatalogOfflineExport.ts` wraps the existing atomic SQLite→JSON export with that authority lease and refuses a missing SQLite database instead of creating an empty catalog. `catalog:export` provides an explicit CLI surface. The resulting JSON is a recovery/rollback artifact only; runtime remains SQLite-only.
- `mediaCatalogOfflineRestore.ts` consumes only a SHA-256-verified offline export while holding the same authority lease. Before mutation it exports the current authoritative rows to a pre-restore JSON backup, then replaces only `photox_media_index` rows in one SQLite transaction while preserving schema/migration metadata. JSON never becomes a live writer and the SQLite database file remains the sole runtime authority.

## Offline operator export
With PhotoX Desktop fully stopped, run:

```bash
npm --workspace @photosync/desktop run catalog:export -- --sqlite "/path/to/photosync-state/media-catalog.sqlite" --out "/safe/path/photox-media-catalog-rollback.json"
```

Record the `sha256` emitted by the command together with the export artifact. Keep the exported JSON outside the active state directory when possible. Do not replace `media-index.json` while PhotoX is running and do not use this artifact as a second live writer.

## Offline operator restore
With PhotoX Desktop fully stopped, restore a previously exported artifact only when its recorded SHA-256 is available:

```bash
npm --workspace @photosync/desktop run catalog:restore -- \
  --sqlite "/path/to/photosync-state/media-catalog.sqlite" \
  --from "/safe/path/photox-media-catalog-rollback.json" \
  --sha256 "<sha256-from-catalog-export>" \
  --backup "/safe/path/pre-restore-current-catalog.json"
```

The restore command verifies the source hash and tenant/media-key uniqueness before taking authority or mutating SQLite. While holding exclusive authority it writes a pre-restore backup of the current SQLite rows, replaces the media rows transactionally, verifies the restored rows, closes SQLite, then releases the authority lease. If Desktop is running, the command fails rather than racing it. A missing/corrupt source, SHA mismatch, duplicate identity, missing/corrupt SQLite database, or malformed authority lock fails closed.

After a successful restore, start PhotoX normally. SQLite remains the sole active runtime catalog; the JSON source and pre-restore backup remain offline recovery artifacts only.

## Active cutover work
1. Extend crash-boundary coverage around interrupted legacy workspace-ID preparation and characterize interruption before/during/after the restore SQLite transaction itself. Stale lease reclamation after an abruptly terminated holder is now process-tested in CI.
2. Wire the diagnostics contract into the Admin/Operations UI without exposing operator-only recovery metadata on Web. Controls must have real backing logic; no mock actions.
3. Add stronger process-level restore interruption acceptance so backup durability and transactional rollback/commit behavior are explicitly proven at each kill point, not only lease reclamation.
4. After remaining crash acceptance is green, stop referring to `media-index.json` as a runtime catalog anywhere in product/operator documentation. Keep it only as the one-time legacy import source and preserved rollback artifact.

## Non-negotiable product constraints carried through cutover
- Google Drive allocation has no fixed 10 GB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota while respecting provider remaining bytes, safety reserve, and configurable per-account ratio.
- Google Photos migration remains Picker-selected only under the current Google Photos Picker API, with append-only destination upload and durable migration state. The product must not claim unrestricted full-library crawling.
- Web and Desktop continue to share the same React UI/components/styles and `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters respectively.
- Workspace/tenant identity must remain authoritative at every catalog operation; identical media keys in different workspaces must never collide.

## Exit criteria for SQLite authority
SQLite is the sole active Desktop media catalog at the production lifecycle boundary. Release acceptance still requires repository tests, Desktop integration tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging, and packaged Desktop smoke to remain green on the final branch head. Platform-signed installers and real power-loss acceptance remain separately reportable as NOT VERIFIED until run in the required platform/signing environment.
