# PhotoX Code Audit & Implementation Plan

## Scope
Audit against the current PhotoX master requirements, with priority on real implementation over mock UI.

## Current architecture
- Mobile: Expo/React Native app under `mobile/`, with most product UI/business orchestration currently concentrated in `mobile/app/index.tsx`.
- Desktop: Electron + React/Vite under `desktop/`, with local receiver/core behavior in Electron main process.
- Shared packages: existing packages already cover auth/JWS, media, media API/cloud/delivery, image-editor recipes, persistence SQLite, jobs, storage providers/replication, Google Drive, Telegram and SDK layers.
- Docs: architecture/security/API/test/run-sync docs exist, but implementation status is not tracked centrally before this file.

## Working or substantially implemented
### Mobile
- Local device media loading.
- QR pairing and saved desktop pairing.
- LAN/public receiver connectivity.
- Real sync calls with progress and retry state.
- Cloud library merging.
- Photo/video fullscreen viewer.
- Video playback through `expo-video`.
- Metadata reading for images.
- Download cloud media to device.
- Album cards now open real filtered grids: Camera, Video, Recent, Backed up.
- Photo editing route uses `@dariyd/react-native-image-filters` with GPU preview, native crop, rotate, adjustments and rendered export.

### Desktop/Core
- Receiver/API endpoints.
- Local/cloud media delivery.
- Range streaming for desktop video.
- Storage abstraction and provider registry.
- Replication service.
- Google Drive / Telegram related packages already exist.

## Partially working
### Mobile library
- Favorite/Archive/Trash are React state only in the main screen and are not yet durable library metadata.
- Album screen has built-in smart albums, but user-created album CRUD is not implemented end-to-end.
- Trash can receive items but restore, permanent delete, empty trash and retention are missing.
- Search currently behaves mainly as filename filtering; metadata/date/type/location/album index is not yet wired into the app.
- Timeline is a flat grid, not grouped/virtualized by date and not scalable to 100k media.
- Viewer lacks swipe-between-assets, pinch/double-tap zoom and preload of neighbors.
- Sharing bottom tab is missing.
- Archive action is missing from viewer toolbar.

### Photo editor
- Core filter/adjust/crop/rotate/export is implemented.
- Undo/redo history UI and replay of recipe operations are incomplete.
- Flip/straighten/perspective are incomplete in the new editor path.
- Retouch/effects/draw/text are not implemented and should stay hidden/disabled until real implementations exist.
- Export format/options (JPEG/PNG/HEIC/WebP, size, quality, metadata stripping) are incomplete.

### Video
- Mobile native player works for supported codecs.
- Thumbnail/duration metadata is not consistently populated for every remote/cloud video.
- HEVC/MOV transcoding fallback path is not fully integrated into mobile delivery.
- Player UX still needs explicit loading/error/retry/current-time handling.

### Sync
- Current upload loop is retryable but is not a true persisted chunk-resume protocol for every interrupted file.
- Background execution is present in dependencies/config but needs end-to-end persisted job recovery verification.
- Network-change and Wi-Fi-only policy need stronger enforcement and tests.

### Storage
- Abstractions and replication code exist.
- Need verification that every provider checks object existence/checksum before marking replicas healthy.
- Need UI drill-down for under-replicated/failed/missing assets.

## Mock-only / misleading UI found
- Some discovery/search category cards have no real search implementation.
- Create menu items such as collage/movie/animation currently close the sheet without implementing the action.
- Some selection-bar actions (share/add-to-album/backup/delete) are not fully wired for multi-selection.
- Notification/bell UI has no backing notification center.

These should either be implemented or visibly disabled/marked unavailable. No fake controls should remain.

## Broken / high-risk areas
1. `mobile/app/index.tsx` is too large and combines navigation, library state, viewer, sync, pairing, albums and settings. This increases regression risk.
2. Mobile library metadata is not persisted independently of source files.
3. Root/package lock state must be kept synchronized after native dependency changes.
4. Video MIME/codec assumptions still need hardening for MOV/HEVC.
5. New image-filter editor requires native rebuild and newer OS deployment targets; device matrix must be verified.

## Priority plan

### P0 — Mobile library correctness
1. Add persistent mobile library metadata store for favorite/archive/trash and user albums.
2. Implement Trash restore/permanent delete/empty trash with retention metadata.
3. Implement user album create/rename/delete/add/remove/cover.
4. Wire multi-select actions to real implementations.
5. Disable create-menu items that do not yet have logic.

### P0 — Video reliability
1. Persist and expose video duration/thumbnail/codec metadata.
2. Ensure HTTP Range support on every mobile-consumed media endpoint.
3. Add codec capability detection and transcode-proxy fallback for unsupported HEVC/MOV.
4. Add explicit loading/error/retry UI.

### P1 — Viewer
1. Asset-indexed viewer state.
2. Horizontal swipe left/right.
3. Pinch and double-tap zoom for photos.
4. Neighbor preload.
5. Archive action and persisted metadata.

### P1 — Editor
1. Undo/redo/reset backed by recipe history.
2. Flip horizontal/vertical and straighten.
3. Export format/quality/metadata options.
4. Keep unsupported Retouch/Draw/Text hidden until real engine exists.

### P1 — Timeline/search/performance
1. Date grouping Today/Yesterday/month.
2. Replace whole-library `.map()` grids with virtualized/paginated lists.
3. Add search index over filename/date/type/camera/lens/location/album/dimensions/duration.
4. Add cache-aware thumbnail loading instead of originals.

### P2 — Sync/storage hardening
1. Persist upload jobs/chunks and resume from acknowledged offset.
2. Add interruption/restart tests.
3. Verify replica checksum/existence before healthy status.
4. Add under-replicated repair queue and health drill-down.

## Definition of done for every next change
- UI exists only if logic exists.
- Persistence added when the feature changes user data.
- Loading/error/empty states exist.
- Android/iOS behavior considered for mobile.
- Tests added for business logic where feasible.
- Documentation updated with the code.
