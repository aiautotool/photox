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

## Next integration batch
1. Instantiate the coordinator in Electron main with production `readIndex(workspaceId)` lookup and the existing exact-row Drive upload scheduler.
2. Add `photosync:repair-media` IPC and expose `repairMedia(key)` in `preload.cts`.
3. Add `repairMedia(key)` to the shared `DesktopBridge` contract and HTTP adapter.
4. Add authenticated `POST /api/web/v1/media/:key/repair`; use the authenticated principal workspace, existing CSRF mutation protection, member-or-higher role, rate limiting and audit persistence.
5. Replace the Problems-page row Repair button with `bridge.repairMedia(problem.key)`. Keep `Sửa tất cả có thể` mapped to the explicit workspace sweep.
6. Add end-to-end transport regressions proving repairing asset A never schedules asset B, even when keys collide across workspaces, and that Web viewer/CSRF failures cannot reach the scheduler.

## Done criteria
Per-media repair is complete only when Electron IPC and Web HTTP both call the same coordinator/transport contract, the shared Desktop/Web React UI uses that exact-media method, all regressions are CI-gated, repository tests/typecheck/build are green, and no existing workspace-wide control is mislabeled as exact-media repair.
