# PhotoX Code Audit & Implementation Plan

## Scope
Audit against the current PhotoX master requirements, with priority on real implementation over mock UI.

## Current architecture
- Mobile: Expo/React Native under `mobile/`. Main screen is `mobile/src/home/MobileHome.tsx`; durable library metadata is under `mobile/src/library/`.
- Desktop: Electron + React/Vite under `desktop/`, with PhotoX receiver/core in Electron main process.
- Shared packages already cover auth/JWS, media, media API/cloud/delivery, image-editor recipes, persistence SQLite, jobs, storage providers/replication, Google Drive, Telegram, video media and FFmpeg adapters.
- Foundation is reusable; do not rewrite it without a migration reason.

## Implemented in the current hardening pass
### Mobile library
- Persistent Favorite, Archive, Trash and user Albums.
- Trash restore, permanent delete for local media and Empty Trash.
- User album create, rename, delete, add photos, remove photos and album cover.
- Smart albums Camera, Video, Recent and Backed up open real filtered grids.
- Multi-select Backup, Trash and Add-to-album have real handlers.
- Single-file native share uses `expo-sharing`; unsupported fake create actions were removed.
- Cloud download preserves the original media endpoint even when playback uses a compatibility derivative.

### Photo editor
- `@dariyd/react-native-image-filters` is the active OSS editor path.
- GPU filter preview and adjustable intensity.
- Brightness, contrast, saturation, exposure, temperature, tint, sharpness and vibrance.
- Interactive crop with aspect ratios.
- Rotate, flip horizontal, flip vertical and straighten.
- Undo/Redo/Reset backed by editor snapshots plus `EditSession` recipe history.
- Hold-to-compare original.
- Full-size rendered save; original is never overwritten.
- Unsupported Retouch/Draw/Text remain hidden instead of exposing fake controls.

### Video pipeline
- Mobile upload now sends correct MIME for MP4, MOV/QuickTime, M4V, WebM, MKV and AVI; image MIME mapping also covers HEIC/HEIF/PNG/WebP/GIF/TIFF/DNG.
- Desktop receiver persists MIME and media type at ingestion.
- HTTP byte Range is implemented for receiver media/playback and Electron `photosync://` playback.
- Desktop now runs FFprobe/FFmpeg processing asynchronously after original ingestion.
- Video index stores width, height, duration, rotation, fps, bitrate, container, video codec, audio codec and processing/error state.
- JPEG video thumbnail generation is integrated.
- Compatibility playback derivative is generated as MP4 H.264/AAC when the original container/codec/audio is not broadly compatible.
- MOV and HEVC compatibility decisions now have regression coverage; corrupt inputs fail closed at probe with stable renderer-safe error codes/messages rather than exposing raw FFprobe stderr or local paths.
- `/api/v1/thumbnail/:key` serves generated thumbnails.
- `/api/v1/playback/:key` serves compatibility playback when present, otherwise safely falls back to original/cloud source.
- `/api/v1/library` exposes processed metadata, thumbnail availability and playback availability to mobile.
- Mobile grids prefer processed `thumbnailUri` for remote video/media and fall back to the original URI only when a thumbnail is unavailable.
- Mobile video viewer exposes real `expo-video` loading/error state, keeps the processed thumbnail as a poster while loading, and retries failed playback with asynchronous source replacement.
- Processing failures do not reject or delete the already-ingested original.
- FFmpeg/FFprobe binaries are packaged via installer dependencies and unpacked from Electron ASAR.

### Storage/core already present
- Receiver/API endpoints and cloud delivery.
- Storage abstraction/provider registry.
- Google Drive multi-account support and replication service.
- Telegram/provider packages and SDK layers.
- Backup health calculation and repair sweep structure.
- Persisted Google Drive replicas are now periodically re-verified against authoritative remote metadata. Missing objects, size mismatch, source SHA-256 app-property mismatch, or MD5 mismatch are downgraded so the existing repair sweep replenishes under-replicated assets; transient provider failures retain last-known VERIFIED state and are retried instead of causing duplicate repair uploads.
- Remote verification is workspace/account scoped, records `remoteCheckedAt` and the provider MD5 baseline, defaults to a 15-minute cadence, and is configurable with `PHOTOX_REPLICA_VERIFY_INTERVAL_MS` (minimum one minute).
- Replica-health persistence now merges only the targeted workspace/key/replica fields onto the latest media-index snapshot and skips replicas removed concurrently, with optimistic compare-before-rename retries to avoid replacing newer ingestion/video/repair metadata with a stale verifier snapshot.
- A per-media repair coordinator now provides exact workspace/key selection, local-original validation, unique verified-account target checks, and in-flight de-duplication. It is regression-tested and CI-gated; IPC/Web/renderer wiring remains the next integration step before replacing the current workspace-wide Repair action.

## Backup UI and cloud management restoration
- Detailed mobile upload progress restored using real native upload byte callbacks: current filename, uploaded bytes, total bytes, remaining bytes and queue count.
- Backup configuration is persisted on-device and controls automatic backup plus photo/video inclusion.
- Cloud-only assets can already be downloaded to the device; viewer keeps the original-download path even when compatibility playback uses a derivative.
- Added authenticated `DELETE /api/v1/media/:key`: managed Google Drive replicas are deleted first; local original/thumbnail/playback and catalog row are removed only after replica deletion succeeds.
- Mobile viewer exposes `Xóa khỏi cloud` with destructive confirmation and removes the deleted asset from local PhotoX metadata.
- Shared Desktop/Web Problems UI now drills into each under-replicated item with unique verified-account count, pending/failed replicas, provider messages, local-original availability and truthful replica state. Repair is disabled when no local original can seed a replacement, and the action invokes the existing real workspace repair sweep without marking the item safe until verification succeeds.

## SaaS V4 priority progress
### Google Drive allocation
- [x] Removed fixed 10 GB PhotoX allocation semantics.
- [x] Default per-account allocation is 2/3 of Google authoritative total quota.
- [x] Writable capacity is additionally bounded by actual provider remaining bytes and per-account safety reserve.
- [x] Per-account ratio and safety reserve persist across restart and feed runtime account selection.
- [x] Renderer-safe allocation snapshots expose provider total/free/used and PhotoX effective writable capacity without OAuth secrets.
- [x] Electron IPC and authenticated Web PATCH transport use the same strict allocation mutation contract with server-derived workspace/account authority.
- [x] Shared Desktop/Web allocation manager now exposes real per-account ratio and safety-reserve editing, authoritative refresh after mutation, reset to production defaults, loading/error states, and no fake 10 GB cap.
- [x] Allocation controls are now embedded directly in the storage-account surface instead of a floating global launcher; the same backed `DesktopBridge` mutation path remains shared by Electron and Web.
- [ ] Live mutation E2E against a real Google account remains NOT VERIFIED.

### Google Photos migration
- [x] Picker-selected source semantics only; no unrestricted full-library crawling claim.
- [x] Google Photos append-only destination and Google Drive destination contracts exist with durable migration state/progress/retry semantics.
- [x] Restart recovery for items with a durable destination `targetId` resumes verification only instead of retransferring; verification failures retain target identity/checkpoint for retry, preventing avoidable duplicate append-only uploads after a process restart.
- [x] Picker-selected media is staged into a workspace/job-scoped durable local spool before the Picker session is deleted; queued/restarted transfers read the spool instead of session-bound Picker URLs.
- [x] Migration spool records size + SHA-256, never persists Picker `baseUrl`, rejects duplicate/malformed manifest items, verifies bytes before transfer, cleans partial staging on failure, and is covered by Electron regression tests.
- [x] Google Drive migration completion now performs a second provider verification from the durable resumable checkpoint/target ID after the runner enters `verifying`; restart verification reuses that checkpoint so it checks the existing remote object rather than starting another upload, and target/checkpoint identity mismatches fail closed.
- [x] Terminal migration cancellation now removes the durable spool; `completed_with_errors` intentionally retains it so failed items can still be retried.
- [ ] Complete live OAuth/provider E2E verification with real accounts.

### Desktop/Web shared product
- [x] Web uses the Desktop React tree through shared `DesktopBridge` semantics.
- [x] Authenticated HTTP/WebSocket adapters, CSRF/CORS/rate-limit/audit boundaries and Range media delivery are implemented where applicable.
- [x] Reverse-proxy forwarded headers are now fail-closed: `X-Forwarded-For` and `X-Forwarded-Proto` are honored only when the immediate peer is in `PHOTOX_WEB_TRUSTED_PROXIES`; direct clients cannot spoof rate-limit identity or HTTPS cookie state.
- [x] Public Web environment parsing now rejects malformed `PHOTOX_WEB_PUBLIC_BASE_URL`, invalid rate limits and invalid trusted-proxy addresses before binding the service.
- [x] WebSocket event upgrades now share the same trusted-client rate-limit identity as HTTP; origin and access-token checks remain fail-closed, trusted proxies separate client buckets, and direct clients cannot rotate spoofed `X-Forwarded-For` values to evade the limiter.
- [ ] Complete deployment acceptance behind a real TLS reverse proxy, including WebSocket upgrade and Range streaming through that proxy.

## Remaining work
### P0 — Release/build correctness
- [ ] Regenerate and commit root `package-lock.json` after native dependency changes.
- [ ] Latest CI must pass install, SDK tests, full typecheck and desktop production build.
- [ ] Device-test image-filter native module on supported iOS/Android builds.
- [x] Mobile grid prefers processed `thumbnailUri` for remote videos; metadata and endpoint are already available.

### P0 — Video UX and acceptance
- [x] Explicit player loading/error/retry UI backed by `expo-video` player status and asynchronous source retry.
- [ ] Verify iPhone MOV/HEVC acceptance path on a real generated sample/device: ingest → ffprobe → thumbnail → duration → compatibility playback → seek/audio/fullscreen.
- [x] Add video-processing regression tests around MOV/HEVC and corrupt video, including fail-closed probe errors that do not serialize raw local paths/FFprobe stderr.

### P1 — Viewer
- [ ] Asset-indexed viewer state.
- [ ] Horizontal swipe left/right.
- [ ] Pinch and double-tap zoom for photos.
- [ ] Neighbor preload.
- [x] Favorite/archive/trash persistence and real actions.

### P1 — Editor
- [x] Undo/redo/reset history.
- [x] Flip horizontal/vertical and straighten.
- [ ] Perspective correction.
- [ ] Export format/quality/metadata options for JPEG/PNG/HEIC/WebP.
- [ ] Preset data/categories and live per-photo preset thumbnails.
- [ ] HSL/tone curve/highlights/shadows/whites/blacks/clarity/dehaze/noise reduction/effects.

### P1 — Albums/sharing
- [x] Create/rename/delete/add/remove/cover.
- [ ] Sort album contents.
- [ ] Album share model/link API.
- [ ] True multi-file native share staging rather than opening only one file.

### P1 — Timeline/search/performance
- [ ] Date grouping Today/Yesterday/month.
- [ ] Year/Month/Day/All Photos density modes and pinch grid density.
- [ ] Replace whole-library `.map()` grids with virtualized/paginated lists.
- [ ] Search index over filename/date/type/camera/lens/location/album/dimensions/duration.
- [ ] OCR/face/object/semantic-search extension interfaces.

### P2 — Sync/storage hardening
- [ ] Persist upload chunks/jobs and resume from acknowledged byte offsets after restart/network interruption.
- [ ] Network-change/Wi-Fi/charging policy enforcement and tests.
- [x] Periodically verify persisted Google Drive replica existence and integrity against authoritative remote metadata before allowing stale VERIFIED state to remain trusted indefinitely; definitive missing/size/SHA-256/MD5 mismatches are downgraded for repair while transient outages defer without duplicating uploads.
- [x] Merge background verifier mutations onto the latest media-index row/replica snapshot instead of replacing a stale whole-index snapshot; tenant/replica identity regressions cover preservation of concurrent metadata and non-resurrection of removed replicas.
- [ ] Migrate all media-index writers to one serialized persistence layer or SQLite transaction boundary; optimistic verifier retries reduce the current race but do not replace a single-writer/transactional store.
- [x] Under-replicated/failed/missing UI drill-down with per-media replica/account/provider details and guarded Repair action backed by the existing real repair sweep.
- [ ] Wire the new per-media repair coordinator through Electron IPC, authenticated Web role/CSRF/audit, shared `DesktopBridge`, and the existing Repair button; coordinator selection/dedupe/eligibility logic is implemented and CI-gated, but the UI intentionally still uses workspace-wide repair until this wiring is complete.
- [ ] Safe PhotoX Core delete endpoint before enabling permanent delete of cloud-only originals.

## CI notes
- A stale IMG.LY patch-package file was removed after it blocked `npm install`.
- Mobile + SDK typecheck passed on the editor/mobile-library hardening commit before video integration.
- Desktop production build then exposed a pre-existing missing iconset asset. The build path now points to a real repository icon blob rather than a placeholder.
- Every V4 batch must still complete repository tests, TypeScript typecheck, production build and CI before being marked complete.

## Definition of done
A feature is DONE only when UI, business logic, persistence (where needed), error/loading/empty states, platform behavior, tests and documentation agree. Rendering a screen or button alone is not completion.
