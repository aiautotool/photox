# V4 Run 057 — Durable workspace-backed resumable quota

## Scope completed

This batch closes the quota-ownership gap identified after the resumable ingest lifecycle foundation. The lifecycle already persisted a `quotaReservationId`, but workspace usage accounting still only exposed byte-counter increment/decrement helpers. A repeated expiry cleanup or retry after restart could therefore release the same logical reservation more than once.

The SQLite workspace repository now owns durable media reservation records in `photox_workspace_media_reservations`. Each reservation records its workspace, device, asset, byte count, UTC ingress period, state, optional committed media key, release reason, and timestamps.

Reservation semantics are fail-closed and idempotent:

- create is atomic with workspace quota accounting under `BEGIN IMMEDIATE`;
- repeating the same reservation ID with the same binding is idempotent, while binding/size drift is rejected;
- commit is idempotent only for the same media key and cannot revive a released reservation;
- release is idempotent and subtracts managed storage exactly once;
- release only subtracts monthly ingress when the reservation belongs to the current UTC ingress period, so expiry of an old session cannot corrupt a later month's usage;
- existing whole-file reservation helpers remain temporarily available for the current non-resumable receiver path.

`desktop/electron/resumableQuotaHooks.ts` now adapts the resumable lifecycle to workspace entitlements and the durable reservation repository. It derives plan limits from the authenticated workspace and verifies the stored device binding and expected byte count before commit or release.

## Regression coverage

Added coverage for:

- idempotent durable reservation creation;
- reservation-ID binding conflicts;
- exactly-once commit/release accounting;
- commit-key conflicts;
- cross-month expiry cleanup;
- authenticated device mismatch and expected-size drift in the resumable quota adapter;
- Desktop test-gate inclusion using the repository's `node:test` harness.

A first gated CI attempt exposed that the new Desktop test had accidentally used Vitest even though the Desktop electron test pipeline compiles and runs `node:test`. The test was converted to the correct harness and the full repository gate then passed.

## Priority requirements carried forward

1. Google Drive allocation remains **not a fixed 10 GiB cap**. Default PhotoX allocation is `2/3` of each account's authoritative total quota, constrained by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains **Picker-selected only** using the current Picker API, with append-only destination upload and no claim of unrestricted full-library crawling.
3. Desktop and Web continue to share the same React UI/components/styles and `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters.

## Not complete yet

This batch does **not** expose resumable upload endpoints and does not claim that mobile upload is byte-offset resumable yet. The current public media receiver still uses the whole-file path.

## Next prioritized batch

Wire the lifecycle and workspace-backed quota hooks into authenticated receiver endpoints:

- create session;
- get server-authoritative status/acknowledged offset;
- append ordered bounded chunks with explicit offset-conflict responses;
- finalize after full SHA-256/size verification;
- expiry cleanup;
- atomic handoff through the existing ingest recovery journal / SQLite catalog commit path.

After the server path is green, mobile can persist `sessionId`, query the acknowledged offset after restart/network loss, and resume from the exact server-confirmed byte boundary.
