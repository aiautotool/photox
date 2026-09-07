# V4 Run 065 — Mobile resumable client foundation

## Context

Run 064 mounted the authenticated resumable receiver in the production Desktop listener while preserving the legacy whole-file upload route for compatibility. The next priority is moving Mobile to byte-offset resume without duplicating protocol logic inside UI code.

## Completed in this batch

- Added `@photox/mobile-sdk` `ResumableUploadClient` for the production `/api/v1/media/uploads` protocol.
- Durable session ownership is abstracted behind `ResumableUploadSessionStore` so the Expo app can persist session IDs and authoritative offsets in its document storage.
- Existing sessions are refreshed from Desktop before sending more bytes; server `acknowledgedBytes` is authoritative after app/network restarts.
- `404` / `410` session loss clears stale client ownership and creates a fresh server session.
- `409 UPLOAD_OFFSET_MISMATCH` updates the durable client offset and continues from the server-confirmed byte rather than replaying already acknowledged data.
- Chunk reads are delegated to `ResumableUploadSource`, allowing the Expo adapter to read bounded file ranges instead of loading whole photos/videos into JS memory.
- SHA-256 is requested only after all bytes are acknowledged, and the durable session is removed only after successful finalize (`COMMITTED` / `ALREADY_RECEIVED` are both returned by the server contract as successful HTTP responses).
- Added SDK integration regressions for restart resume, stale-offset reconciliation, expired-session recreation and ledger clearing after finalize.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only through the current Google Photos Picker API, with append-only transfer to a destination Google Photos account or connected Google Drive account. Do not advertise unrestricted full-library crawling.
3. Web and Desktop continue sharing the exact React UI/components/styles through the shared `DesktopBridge` contract, with authenticated HTTP/WebSocket public adapters and Range-preserving media delivery.

## Remaining before Mobile resumable is production-ready

- Implement the Expo production adapters: document-backed session store, bounded file-range chunk reader and SHA-256 source hashing.
- Wire `syncAssetsToLaptop()` local/public transport through `ResumableUploadClient`; keep relay/legacy whole-file only as compatibility fallback during rollout.
- Surface byte progress from authoritative acknowledged offsets.
- Confirm token refresh behavior for 401s and ensure a refreshed workspace bearer token is used for every status/chunk/finalize request.
- Add device-level restart/network-loss acceptance tests on iOS and Android.

## Verification policy

This batch is complete only when repository tests, TypeScript typecheck, production build and repository CI are green. Platform signed artifacts and physical-device restart/background execution remain NOT VERIFIED until run in the appropriate signing/device environments.
