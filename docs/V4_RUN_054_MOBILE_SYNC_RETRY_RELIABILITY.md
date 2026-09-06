# V4 Run 054 — Mobile sync retry reliability

## Why this batch

The mobile background sync path previously filtered out every asset present in `photosync-failed-assets.json`. That made a transient network, relay, laptop-offline, or provider error effectively permanent unless the user manually forced a retry.

## Implemented

- Keep the existing failure-message ledger shape so current Mobile UI remains compatible.
- Add a durable retry metadata ledger at `photosync-failed-retry.json`.
- Persist per-asset retry attempts, failure timestamp, and next retry timestamp.
- Use exponential retry delay beginning at 1 minute and capped at 6 hours.
- Background sync retries failed assets once their durable retry deadline is due instead of excluding them forever.
- Legacy failed assets that predate retry metadata are immediately retryable, avoiding stranded uploads after upgrade.
- Successful upload clears both the visible failure ledger and retry metadata through the existing `clearAssetFailed` completion path.

## Deliberately not claimed complete

This batch does **not** claim byte-range upload resume. The current mobile upload uses Expo background binary upload and the Desktop receiver commits the asset only after receiving and validating the complete declared byte length. A later batch must add a server-authoritative resumable chunk/session protocol before PhotoX can truthfully resume from an acknowledged byte offset after process restart.

## Carried P0 requirements

1. Google Drive allocation remains free of a fixed 10 GiB cap: default PhotoX allocation is two thirds of authoritative provider total quota, further bounded by actual provider remaining bytes and the configured safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only, durable, resumable at the migration-job level, and append-only for Google Photos destinations. PhotoX must never advertise unrestricted full-library crawling.
3. Web and Desktop continue sharing the same React UI/components/styles and `DesktopBridge`, with Electron IPC locally and authenticated HTTP/WebSocket adapters for Web.

## Validation contract

Repository CI remains authoritative for this connector-only run and must execute repository tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder package, and packaged app smoke before this batch is considered complete.

## Next prioritized batch

Design and implement a server-authoritative resumable media-ingest session: durable upload/session ID, expected total size, acknowledged byte offset, chunk integrity/ordering, workspace/device binding, expiration/cleanup, final whole-file verification, and mobile restart recovery. Do not infer acknowledged progress from client bytes sent.
