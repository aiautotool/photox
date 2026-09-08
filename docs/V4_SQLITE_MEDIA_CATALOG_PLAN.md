# PhotoX V4 — SQLite Media Catalog Cutover Plan

## Goal
Move the active Desktop/Web media catalog from `media-index.json` to the existing `@photox/persistence-sqlite` store without changing the semantic behavior already enforced by `mediaIndexRuntimeWriter`: exact `workspaceId + media key` identity, tenant isolation, deletion tombstones, replica merge semantics, restart recovery, and fail-closed corruption handling.

## Completed foundation
- Added `SqliteMediaIndexCatalog` to `@photox/persistence-sqlite`; it uses `node:sqlite`, the same dependency-free SQLite runtime already used by PhotoX persistence, so no native addon or new Electron packaging dependency is introduced.
- Added schema version metadata and a composite primary key on `workspace_id + media_key`.
- Rows are stored as authoritative JSON payloads behind the composite key during the first cutover stage. This deliberately preserves all current media/video/replica/deletion fields losslessly while allowing later normalization without coupling the migration to today's renderer shape.
- Added strict one-time legacy JSON import. The importer validates the root shape, requires non-empty workspace/media identity, rejects duplicate identities before opening the import transaction, and rejects a non-empty SQLite target.
- Added an idempotent `media-index-json-import-v1` marker containing source SHA-256, row count, import time and rollback-backup path. Re-running against the exact same source returns `ALREADY_IMPORTED`; a changed source after a completed import fails closed with `MEDIA_INDEX_MIGRATION_SOURCE_CHANGED`.
- The original `media-index.json` is copied to an exclusive, fsynced rollback artifact before cutover. An existing backup is accepted only if its SHA-256 matches the current source.
- Import rows and the completed import marker are committed in one `BEGIN IMMEDIATE` transaction, so a database crash cannot expose a partial imported catalog with a success marker.
- Added atomic legacy JSON export from SQLite for rollback/operator recovery. The export file is fsynced before rename and the parent-directory fsync is best effort for cross-platform compatibility.
- Added transactional exact `get`, workspace/all listing, append, patch and remove primitives. Patch refuses any mutation that changes workspace/media identity.
- Regression tests cover metadata/tombstone/replica preservation, identical keys in separate workspaces, idempotent re-import, changed-source rejection, duplicate/corrupt input fail-closed behavior, non-empty target protection, identity immutability, removal isolation and rollback-compatible export.
- Repository CI 803 on code commit `4ad95076a03973db27d4993a9a3d7396950fd54b` passed tests, TypeScript typecheck, production build, built Desktop renderer smoke, electron-builder packaging and packaged Desktop application smoke.

## Cutover invariants
1. JSON remains the active catalog until startup cutover code can prove the SQLite import marker and row count/hash validation are consistent.
2. Startup must never silently treat corrupt JSON or corrupt SQLite as an empty library.
3. During cutover there must be exactly one active writer backend. Dual-write is not allowed because it creates an ambiguous recovery authority after a crash.
4. Existing ingest recovery journals and deletion tombstones must resolve against the SQLite catalog after cutover using the same exact tenant/media identity.
5. The original JSON rollback artifact remains read-only until a later post-cutover acceptance milestone explicitly retires it.
6. Desktop and Web must continue to consume the same catalog through shared backend semantics; renderer/API contracts must not change merely because storage moves to SQLite.
7. Google Drive replica allocation remains governed by authoritative quota, actual provider remaining bytes, safety reserve and per-account allocation ratio; catalog cutover must not introduce a fixed capacity assumption.
8. Google Photos migration remains Picker-selected only and append-only; catalog cutover must not imply unrestricted Photos-library enumeration.

## Next prioritized batch
1. Add a Desktop media-catalog backend adapter that implements the current runtime writer/read contract on top of `SqliteMediaIndexCatalog`, including replica merge and deletion-claim semantics.
2. Add startup cutover orchestration: strict-read legacy JSON, migrate/tag legacy workspace rows before import, create/verify rollback artifact, import transactionally, reopen/read SQLite, compare authoritative identities/count, then select SQLite as the sole active backend.
3. Route `readAllIndex`, `readIndex`, `mediaIndexWriter`, startup ingest recovery and tombstone replay through the selected catalog backend. Remove active JSON writes only after tests prove no fallback path can resurrect stale JSON.
4. Add crash/restart acceptance around the cutover boundary: crash before backup, after backup/before transaction, during transaction, after transaction/before backend selection, and on restart with source-changed/corrupt SQLite states.
5. Add observability/audit for migration start, imported count/hash, cutover success/failure and rollback-export creation without logging media contents or auth/provider secrets.

## NOT VERIFIED
- Real process-kill or power-loss recovery on Windows/macOS/Linux during the SQLite cutover.
- Signed Windows/macOS distribution packaging and signed iOS/Android artifacts.
- Live Google Drive/Google Photos/Stripe/public-TLS acceptance. These remain separate production gates.
