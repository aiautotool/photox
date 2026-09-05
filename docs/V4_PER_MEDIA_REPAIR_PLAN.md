# PhotoX V4 — Per-media Repair Integration Plan

## Goal
Replace the shared Desktop/Web Problems-page Repair action that currently starts a workspace-wide cloud repair sweep with a real exact-media repair path. The final path must never allow a caller to choose another workspace and must not mark an asset safe until the existing Drive upload + verification pipeline verifies the replacement replica.

## Completed
- Exact `MediaRepairCoordinator` selects one `workspaceId + media key`, validates a local original is available, counts verified replicas by unique Drive account, respects the target replica count, and de-duplicates concurrent clicks for the same asset.
- `mediaRepairTransport.ts` is the shared authorization/audit boundary for Desktop and Web integration.
- Repair transport requires `member` or higher role; `viewer` and missing roles fail closed before media lookup or scheduling.
- Workspace authority comes only from the trusted/authenticated principal. The request payload contains only the media key, so a browser cannot submit a different workspace ID.
- Media keys are normalized and empty keys are rejected before coordinator execution.
- Successful and already-safe requests emit exact-media audit metadata (`media.repair`, key, result status, verified replicas, target replicas, source).
- Regression coverage includes role enforcement, tenant isolation for identical keys, pre-lookup viewer rejection, exact audit identity, already-safe no-op behavior and empty-key rejection.
- Transport and regression files are included in the Electron test TypeScript gate.
- Desktop production runtime wires the coordinator to an exact `workspace + media key` Drive repair scheduler and registers `photosync:repair-media` IPC.
- Desktop preload exposes real `repairMedia(key)` IPC.
- Shared `DesktopBridge` declares `repairMedia(key)` and the authenticated HTTP adapter maps it to `POST /api/web/v1/media/:key/repair`; renderer regression coverage verifies URL-safe media keys, bearer auth, POST semantics and CSRF forwarding.
- Web edge now implements authenticated `POST /api/web/v1/media/:key/repair`. It derives workspace only from the bearer principal, requires `member` or higher before the repair handler, inherits global CORS/CSRF/rate-limit protection, and uses the same exact-media coordinator/transport runtime for production audit + scheduling.
- Web authorization distinguishes exact media streaming from nested media mutations, so the repair route uses normal authenticated API scope instead of being misclassified as a signed/download media request.
- Web regressions are CI-gated and prove encoded keys preserve exact identity, identical keys stay scoped to their authenticated workspace, and CSRF/viewer failures do not reach the repair scheduler.
- Exact Desktop/Web repair reuses the authoritative Drive allocation projection (`driveRuntimeAllocation` + `chooseAccount`), so account eligibility continues to honor authoritative provider quota, actual remaining bytes, safety reserve and the persisted per-account allocation ratio rather than any fixed capacity.
- Exact repair requires a valid source SHA-256, writes it as the Drive `photosyncSha256` app property, then reads the remote object back and verifies remote size + SHA-256 metadata before marking the replacement replica `VERIFIED`.
- Exact repair media-index mutations now run through `mediaIndexSerializedStore.ts`, which serializes migrated writers in-process and retains compare-before-rename retry against legacy writers. Regression coverage proves concurrent serialized writers preserve both updates, legacy external changes are merged on retry, and malformed index shape fails closed.
- The serialized media-index store now uses a crash-safer atomic commit: temporary files are opened exclusively, written and fsynced before rename, the parent directory is best-effort fsynced after rename, and temporary files are removed on mutation failure or retry exhaustion. Regressions verify failed/retried mutations leave no orphan temp files and preserve the external winning snapshot.
- Background Drive replica verification now also writes replica-health patches through `mediaIndexSerializedStore.ts` instead of maintaining its own independent compare/rename implementation. It still merges only replica fields into the latest workspace/media row and therefore cannot replace newer media metadata wholesale.
- Concurrency regressions now exercise verifier-versus-legacy-ingest and verifier-versus-legacy-video-processing races. Both force an external write during the verifier mutation and verify the serialized retry preserves the newly ingested row / processed video metadata while still applying replica health state.
- Shared Desktop/Web Problems UI now routes each row-level Repair action through `repairMedia(problem.key)` only. The existing `Sửa tất cả có thể` button intentionally remains mapped to the explicit workspace-wide repair sweep.
- Renderer repair delegation is isolated behind `repairBackupProblem`, whose bridge contract exposes only `repairMedia`. Regression coverage proves the selected media key is normalized and forwarded exactly once and an empty key is rejected before any bridge call, preventing fallback to `retryCloud()`.
- Added `mediaIndexMutationRepository.ts` as the exact-identity JSON catalog mutation boundary for the remaining runtime writers. It provides serialized append/patch/remove operations keyed by `workspaceId + media key`, prevents a patch from moving rows across tenant/media identity, rejects duplicate identities, and supports first-run creation when `media-index.json` does not yet exist.
- Repository regression coverage verifies first-run initialization, concurrent ingest + video/cloud patch preservation, tenant-isolated patch/remove for identical keys, identity immutability, duplicate-key fail-closed behavior, and null results for missing exact identities. The tests are included in the Electron CI gate.
- Exact repository result semantics are now retry-safe: `patch` and `remove` reset attempt-local match state whenever `mediaIndexSerializedStore` retries after an external writer wins, and `patch` returns the row from the committed snapshot. This prevents a stale optimistic attempt from being reported to runtime callers as an authoritative successful mutation.
- Added `mediaIndexRuntimeWriter.ts` as the semantic adapter for the remaining main-process JSON writers. It exposes exact `ingest`, `patchVideo`, `upsertReplica`, and `remove` operations on top of the mutation repository. Replica writes merge by Drive account against the latest committed row, preserve unrelated provider state, and replace account-less queue markers instead of accumulating retry placeholders. Concurrency regressions cover ingest + video + replica races, per-account replica merge preservation, bounded pending markers, and tenant-isolated delete.

## Next integration batch
1. Wire main-process `receiveMedia`, `processVideoRow`, legacy Drive upload persistence and `deleteManagedMedia` to `mediaIndexRuntimeWriter.ts`; the semantic adapter and its race coverage are now CI-gated, so this step should only replace the remaining whole-workspace call sites.
2. Remove or constrain legacy whole-workspace `writeIndex` replacement after all active runtime writers use exact identity mutations; keep only an explicit migration-only path if still required.
3. Add main-runtime integration regressions for ingest-vs-video, ingest-vs-replica and delete-vs-background verification after the call sites use the runtime writer.
4. Once all JSON catalog writers share the boundary, move the durable catalog to SQLite transactions and keep a one-time migration path from existing `media-index.json` state.

## Done criteria
Per-media repair is complete when Electron IPC and Web HTTP call the same coordinator/transport contract, the shared Desktop/Web React UI uses that exact-media method, all regressions are CI-gated, repository tests/typecheck/build are green, and no existing workspace-wide control is mislabeled as exact-media repair.
