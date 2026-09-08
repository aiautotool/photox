# V4 Run 059 — Background backup policy enforcement

## Why this batch

The mobile app already persisted `enabled`, `backupPhotos`, and `backupVideos`, but the registered background task did not read those settings before scanning and uploading the device library. That made the settings UI truthful only for foreground flows and allowed background work to continue after automatic backup was disabled or a media type was excluded.

## Implemented

- `runPairedSync()` now loads the durable backup settings before pairing, network access, or media-library enumeration.
- When automatic backup is disabled, background sync exits successfully without contacting the Desktop receiver or requesting/scanning the media library.
- When both photo and video backup are disabled, background sync also exits successfully without unnecessary work.
- Candidate assets are filtered by the persisted photo/video policy before the synced/failed/retry ledgers are evaluated and before upload begins.
- Unknown media types fail closed and are not selected for background backup.
- Existing durable retry/backoff behavior remains unchanged for assets that are allowed by policy.

## P0 invariants carried forward

- Google Drive allocation has no fixed 10 GiB PhotoX cap. The default per-account ratio remains 2/3 of authoritative Google total quota, additionally bounded by authoritative remaining provider bytes and configured safety reserve; the ratio is configurable per account.
- Google Photos migration remains Picker-selected only. PhotoX must not claim unrestricted full-library crawling. Destination Google Photos writes remain append-only; Google Drive remains the alternate supported destination with durable migration state.
- Desktop and Web continue to share the same React UI/components/styles through `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters and the existing Web security boundaries.

## Still incomplete

- The authenticated resumable media HTTP handler is implemented and tested but is not yet mounted in the production `startReceiver()` composition. Production mobile upload therefore must not yet be described as server-authoritative byte-offset resumable.
- Network-type (for example Wi-Fi-only) and charging-only automatic-backup policies are not implemented yet; no mock controls should be exposed for them.
- Live Google Drive/Google Photos provider acceptance, real TLS reverse-proxy/WebSocket/Range acceptance, physical-device background execution, and signed release artifacts remain external acceptance items.

## Next batch

Refactor receiver construction enough to mount the existing resumable `create/status/chunk/finalize` handler without a second server or a parallel quota/catalog authority. The mounted lifecycle must reuse workspace authentication, durable quota reservation ownership, ingest recovery journal, SQLite media catalog, and the existing post-ingest video/cloud processing path. Then migrate mobile upload to persist the server session ID and resume from server-acknowledged bytes.
