# V4 Run 056 — Resumable quota reservation ownership

## Completed in this batch

- Resumable upload session metadata now durably persists an optional `quotaReservationId` next to the authenticated workspace/device binding and server-authoritative acknowledged offset.
- Lifecycle creation can reserve workspace quota before creating the session. If durable session creation fails, the reservation is released with reason `create_failed`.
- A successful final media commit commits the corresponding quota reservation only after the media commit succeeds.
- Duplicate finalize releases the reservation instead of counting ingress/storage twice.
- Commit/hash failures keep the durable session and reservation intact so a later finalize retry does not reserve the same file again.
- Expired-session cleanup releases the durable reservation before deleting the session files.
- Restart acceptance verifies that the reservation ID survives process restart together with the acknowledged byte offset.

## Safety / compatibility

- Existing version-1 session metadata without `quotaReservationId` remains readable for upgrade compatibility.
- Quota hooks are optional until the receiver is wired to the workspace repository; therefore existing tests and non-wired callers preserve behavior.
- No public UI advertises byte-resume yet. Mobile still uses the existing whole-file transport until authenticated create/status/chunk/finalize routing is connected.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only and append-only at a Google Photos destination; unrestricted full-library crawling must never be advertised.
3. Desktop and Web continue to share React UI/components/styles and the `DesktopBridge` contract, with Electron IPC plus authenticated HTTP/WebSocket adapters.

## Next prioritized batch

Wire this lifecycle to the real workspace quota repository and authenticated receiver endpoints (`create`, `status`, `chunk`, `finalize`). The receiver must enforce body limits, session/workspace/device binding, offset conflict responses, final SHA-256 verification and atomic handoff through the existing ingest recovery journal + SQLite catalog commit path. Only after that should mobile persist a session ID and resume from the server-returned acknowledged offset.
