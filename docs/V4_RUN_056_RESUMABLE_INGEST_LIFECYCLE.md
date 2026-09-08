# V4 Run 056 — Resumable ingest lifecycle

## Completed in this batch

- Added an authoritative resumable-ingest lifecycle on top of the durable session store.
- Session creation is bound to the authenticated workspace/device principal; caller-supplied tenant/device identity is not accepted by the lifecycle API.
- Status returns the durable server-owned `acknowledgedBytes`, including after Desktop restart.
- Chunk writes continue to use the durable ordered-offset store from Run 055.
- Finalization requires a complete server-side part file and a valid SHA-256 supplied by the client, recomputes SHA-256 from the complete server file, and fails closed on mismatch.
- Verified finalization is serialized through the existing `(workspaceId, media key)` media-ingest commit coordinator.
- Duplicate finalization returns `ALREADY_RECEIVED` without running the commit callback.
- Successful or duplicate finalization removes the upload session. Hash mismatch or commit failure retains the complete session so finalization can be retried safely.
- Added regression coverage for workspace/device binding, restart status, whole-file verification, duplicate handling, and retry after commit failure. The regression is included in the Desktop electron test gate.

## Important boundary

This batch deliberately does **not** claim the public/mobile resumable protocol is complete yet. The lifecycle is backing logic, but `desktop/electron/main.ts` still needs authenticated HTTP `create/status/chunk/finalize` routing and the mobile client still needs to persist `sessionId` and resume from server `acknowledgedBytes`.

Quota reservation ownership is also still pending. Before the new public endpoints replace whole-file ingest, each resumable session must own a durable workspace storage reservation that survives restart and is released on commit, duplicate, expiry, or explicit abort. This prevents partially uploaded sessions from bypassing plan storage limits.

## Carry-forward product invariants

1. Google Drive allocation has no fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of the authoritative total Google account quota, bounded by actual provider remaining bytes and the configured safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected only. PhotoX must not advertise unrestricted Google Photos library crawling. Google Photos destination is append-only upload; Google Drive remains a supported destination.
3. Desktop and Web continue to share the same React UI/components/styles and `DesktopBridge`; public Web access remains authenticated and role-enforced with transport hardening and Range streaming preserved.

## Next batch

1. Add durable workspace quota reservation ownership to resumable sessions.
2. Wire authenticated receiver HTTP endpoints to the lifecycle with strict request-size/content-type/error mapping.
3. Atomically hand verified completed sessions into the existing ingest recovery journal/catalog commit path.
4. Update mobile to persist `sessionId`, query status after restart/network loss, seek local content to server `acknowledgedBytes`, and upload only the remaining chunks.
5. Add integration tests for auth denial, tenant/device mismatch, restart resume, quota release, expiry cleanup, hash mismatch, commit retry, and duplicate media.
