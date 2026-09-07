# V4 Run 061 — Resumable Finalize Reconciliation

## Scope

This batch closes the resumable-ingest ownership gap where the media commit can succeed durably but the workspace quota reservation commit fails afterward. Without durable ownership, a retry can observe the media as already existing and incorrectly treat the same upload as an unrelated duplicate, releasing its reservation instead of reconciling quota for the media that was already committed.

## Implemented

- Added a durable per-session finalize ledger under the resumable receiver runtime.
- The ledger binds session, workspace, device, quota reservation, expected bytes, media key and verified SHA-256.
- Ledger writes use fsync plus atomic rename and reject binding/key/hash conflicts.
- After a successful media commit, finalize ownership is persisted before quota commit.
- If quota commit fails, the upload session, verified part and finalize marker remain durable.
- Retry after process restart detects the marker and completes the same quota reservation instead of entering the duplicate-release branch.
- Expiry cleanup also reconciles a marked media commit by committing quota rather than releasing it.
- True pre-existing duplicates with no finalize ownership marker keep the existing release behavior.
- Added regression coverage for restart reconciliation, expiry reconciliation, idempotent ledger writes and conflict rejection; included the suite in the Electron repository test gate.

## Production invariant

A server-owned finalize marker now distinguishes “this session already committed this media and still owes quota reconciliation” from “this media existed before this session”. This prevents double accounting and incorrect reservation release across retry/restart boundaries.

## Validation

CI run 912 on code HEAD `8932626b8fd3fe96c39c119fba5ee2d897e0ad8a` completed successfully: repository tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder package, and packaged Desktop application smoke all passed.

Platform signing, physical-device restart/power-loss acceptance, live Google Drive/Google Photos credentials, public TLS/reverse-proxy deployment, and Stripe live E2E remain NOT VERIFIED.

## Carried-forward P0 requirements

1. Google Drive account allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total storage quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, with append-only upload to another Google Photos account or transfer to a connected Google Drive account. Never advertise unrestricted full-library crawling.
3. Web and Desktop continue to share the same React UI/components/styles and DesktopBridge contract, with Electron IPC and authenticated HTTP/WebSocket adapters plus secure reverse-proxy/public exposure.

## Remaining resumable work

The resumable runtime is still not mounted into production `startReceiver()`, so the public production receiver remains on the compatible whole-file `/api/v1/media` path. The next batch should mount the runtime with `media:write` authorization, workspace-backed quota hooks and the production commit adapter while preserving the whole-file route during migration. After that gate is green, mobile can persist `sessionId`, query authoritative `acknowledgedBytes`, and upload only the remaining chunks after restart/network loss.

A residual extreme disk-failure window remains if media commit succeeds but writing the finalize marker itself fails. The longer-term hardening path is to co-locate finalization ownership with the ingest recovery/catalog durability boundary rather than claim cross-file atomicity.
