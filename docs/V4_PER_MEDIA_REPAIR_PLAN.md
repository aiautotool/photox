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
- Desktop production runtime now wires the coordinator to an exact `workspace + media key` Drive repair scheduler and registers `photosync:repair-media` IPC.
- Desktop preload exposes real `repairMedia(key)` IPC.
- Shared `DesktopBridge` now declares `repairMedia(key)` and the authenticated HTTP adapter maps it to `POST /api/web/v1/media/:key/repair`; renderer regression coverage verifies URL-safe media keys, bearer auth, POST semantics and CSRF forwarding. The Problems-page control remains on the existing sweep until the Web endpoint is implemented, so the shared React tree does not expose a half-wired action.
- Exact Desktop repair reuses the authoritative Drive allocation projection (`driveRuntimeAllocation` + `chooseAccount`), so account eligibility continues to honor authoritative provider quota, actual remaining bytes, safety reserve and the persisted per-account allocation ratio rather than any fixed capacity.
- Exact Desktop repair requires a valid source SHA-256, writes it as the Drive `photosyncSha256` app property, then reads the remote object back and verifies remote size + SHA-256 metadata before marking the replacement replica `VERIFIED`.
- Exact media-index mutation is scoped to the requested workspace/key and uses compare-before-rename retry to reduce lost updates while the broader single-writer/transactional media-index migration remains pending.

## Next integration batch
1. Add authenticated `POST /api/web/v1/media/:key/repair`; use the authenticated principal workspace, existing CSRF mutation protection, member-or-higher role, rate limiting and audit persistence.
2. Replace the Problems-page row Repair button with `bridge.repairMedia(problem.key)`. Keep `Sửa tất cả có thể` mapped to the explicit workspace sweep.
3. Add end-to-end transport regressions proving repairing asset A never schedules asset B, even when keys collide across workspaces, and that Web viewer/CSRF failures cannot reach the scheduler.
4. Continue the broader media-index persistence migration toward a serialized writer or SQLite transaction so exact repair, ingest, video processing and replica verification share one transactional mutation boundary.

## Done criteria
Per-media repair is complete only when Electron IPC and Web HTTP both call the same coordinator/transport contract, the shared Desktop/Web React UI uses that exact-media method, all regressions are CI-gated, repository tests/typecheck/build are green, and no existing workspace-wide control is mislabeled as exact-media repair.
