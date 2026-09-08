# PhotoX V4 — Run 010 ingest commit coordination

## Why this batch exists
`receiveMedia()` currently streams to a unique incoming temp file, but after hashing it chooses/renames the final library path before the exact media-index append decides which concurrent request owns `workspaceId + media key`. Two simultaneous uploads of the same identity can therefore leave an overwritten/orphaned local file even though the catalog itself rejects duplicate identity.

## Completed in this run
- Added `mediaIngestCommitCoordinator.ts`, keyed by exact `workspaceId + media key`.
- Same-identity commits are serialized. After the first commit finishes, the next waiter performs a fresh authoritative `exists()` check before any commit/file-placement callback is allowed to run.
- Same media key in different workspaces remains independent; tenant isolation is part of the lock identity.
- Failed commit attempts always release the key so a later retry can proceed.
- Empty workspace/key identities fail closed before dependency callbacks execute.
- Added CI-gated regressions for duplicate-before-side-effect behavior, cross-workspace independence, failed-commit release, and invalid identity rejection.

## Next integration batch
1. Wire `receiveMedia()` so final-path selection/rename plus exact `mediaIndexWriter().ingest()` execute inside the coordinator. A duplicate waiter must return `208 ALREADY_RECEIVED` without touching the final library path.
2. If a commit fails after rename but before catalog commit, remove only the file created by that claim and preserve any pre-existing authoritative file.
3. Extend `mediaIndexRuntimeWiring.test.ts` so production ingest cannot regress to file placement outside the exact ingest coordinator.
4. Remove/constrain the now-unused `writeIndex()` / `updateIndexRow()` helpers and the `replaceWorkspaceRows` import from runtime code; keep legacy JSON workspace migration explicit and one-time only.
5. Add restart-level deletion-tombstone recovery acceptance, then start the one-time JSON catalog to SQLite transactional migration.

## Priority requirements carried forward
- Google Drive allocation remains based on authoritative provider total quota with a default PhotoX ratio of 2/3, bounded by actual provider remaining bytes and safety reserve, configurable per account. No fixed 10 GB cap.
- Google Photos migration remains Picker-selected source media only, with append-only destination upload / Drive transfer, durable ledger and resumable progress semantics. Do not advertise unrestricted full-library crawling.
- Web/Desktop continue sharing the same React UI/components/styles and `DesktopBridge` contract, with authenticated HTTP/WebSocket adapters and production public-access hardening.
