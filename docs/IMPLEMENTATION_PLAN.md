# PhotoX Code Audit & Implementation Plan

## Scope
Audit against the current PhotoX master requirements, with priority on real implementation over mock UI.

## Current architecture
- Mobile: Expo/React Native under `mobile/`. The previous oversized `mobile/app/index.tsx` has been reduced to a route export; the main screen now lives in `mobile/src/home/MobileHome.tsx` and durable library metadata lives under `mobile/src/library/`.
- Desktop: Electron + React/Vite under `desktop/`, with local receiver/core behavior in Electron main process.
- Shared packages: existing packages already cover auth/JWS, media, media API/cloud/delivery, image-editor recipes, persistence SQLite, jobs, storage providers/replication, Google Drive, Telegram and SDK layers.
- Docs: architecture/security/API/test/run-sync docs exist; this file tracks implementation gaps and progress.

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
- Smart album cards open filtered grids: Camera, Video, Recent, Backed up.
- Photo editing route uses `@dariyd/react-native-image-filters` with GPU preview, native crop, rotate, adjustments and rendered export.
- Durable Favorite / Archive / Trash metadata via `LibraryStateStore`.
- User album model with create/delete/add/remove/cover operations in `LibraryController`.
- Trash restore, permanent local delete, empty-trash and retention helpers.
- Multi-select actions now call real handlers for backup, trash and add-to-album; native file sharing is integrated through `expo-sharing`.
- Obsolete IMG.LY dependency and patch-package patch were removed.

### Desktop/Core
- Receiver/API endpoints.
- Local/cloud media delivery.
- Range streaming for desktop video.
- Storage abstraction and provider registry.
- Replication service.
- Google Drive / Telegram related packages already exist.

## Partially working
### Mobile library
- Album rename UI still needs a production interaction flow; controller support exists.
- Album cover selection and remove-from-album need dedicated UI actions; controller support exists.
- Multi-file OS sharing currently needs a staging/export bundle; single-file native share is implemented.
- Search currently covers filename/type in the mobile UI; metadata/date/camera/lens/location/album index is not yet wired.
- Timeline is still a flat grid, not grouped/virtualized by date and not scalable to 100k media.
- Viewer lacks swipe-between-assets, pinch/double-tap zoom and neighbor preload.
- Sharing bottom tab/shared-link collaboration model is not implemented.

### Photo editor
- Core filter/adjust/crop/rotate/export is implemented.
- Undo/redo history UI and replay of recipe operations are incomplete.
- Flip/straighten/perspective are incomplete in the new editor path.
- Retouch/effects/draw/text are not implemented and stay hidden rather than exposing fake buttons.
- Export format/options (JPEG/PNG/HEIC/WebP, size, quality, metadata stripping) are incomplete.

### Video
- Mobile native player works for supported codecs.
- Receiver media endpoint supports byte Range, but MIME mapping is still too coarse for MOV/HEVC and images.
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

## Mock-only / misleading UI removed or identified
- Old collection album cards without `onPress` were fixed.
- Old multi-select action bar without handlers was replaced.
- Old collage/movie/animation create-menu mock entries were removed from the main mobile screen.
- Notification/bell mock was removed from the refactored mobile header.
- Unsupported editor tools remain hidden rather than presented as working.

## Broken / high-risk areas
1. Root package lock is stale after editor/sharing native dependency changes and must be regenerated before release.
2. Video MIME/codec assumptions still need hardening for MOV/HEVC.
3. New image-filter editor requires native rebuild and newer OS deployment targets; device matrix must be verified.
4. Physical cloud delete is intentionally not exposed until PhotoX Core has a safe delete endpoint; cloud trash therefore remains metadata-only to avoid accidental data loss.

## Priority plan

### P0 — Mobile library correctness
- [x] Persistent mobile library metadata store for favorite/archive/trash and user albums.
- [x] Trash restore/permanent local delete/empty trash + retention metadata.
- [x] User album domain operations: create/rename/delete/add/remove/cover.
- [x] Multi-select backup/trash/add-to-album handlers.
- [x] Remove fake create-menu actions.
- [ ] Finish rename/cover/remove album UI.
- [ ] Multi-file native share staging.

### P0 — Video reliability
- [ ] Persist and expose video duration/thumbnail/codec metadata.
- [x] HTTP Range support on desktop viewer and mobile-consumed receiver endpoint.
- [ ] Correct MIME for MOV/M4V/WebM/HEIC/PNG/WebP.
- [ ] Codec capability detection and transcode-proxy fallback for unsupported HEVC/MOV.
- [ ] Explicit loading/error/retry UI.

### P1 — Viewer
- [ ] Asset-indexed viewer state.
- [ ] Horizontal swipe left/right.
- [ ] Pinch and double-tap zoom for photos.
- [ ] Neighbor preload.
- [x] Archive action and persisted metadata.

### P1 — Editor
- [ ] Undo/redo/reset backed by recipe history.
- [ ] Flip horizontal/vertical and straighten.
- [ ] Export format/quality/metadata options.
- [x] Unsupported Retouch/Draw/Text hidden until real engine exists.

### P1 — Timeline/search/performance
- [ ] Date grouping Today/Yesterday/month.
- [ ] Replace whole-library `.map()` grids with virtualized/paginated lists.
- [ ] Add search index over filename/date/type/camera/lens/location/album/dimensions/duration.
- [ ] Cache-aware thumbnail loading instead of originals.

### P2 — Sync/storage hardening
- [ ] Persist upload jobs/chunks and resume from acknowledged offset.
- [ ] Add interruption/restart tests.
- [ ] Verify replica checksum/existence before healthy status.
- [ ] Add under-replicated repair queue and health drill-down.

## CI / release notes
- The first CI after removing IMG.LY failed during `npm install` because a stale `patches/@imgly+editor-react-native+1.81.1.patch` remained. That obsolete patch has now been deleted.
- CI must pass `npm install`, SDK tests, mobile typecheck and desktop build before this batch is considered release-ready.

## Definition of done for every next change
- UI exists only if logic exists.
- Persistence added when the feature changes user data.
- Loading/error/empty states exist.
- Android/iOS behavior considered for mobile.
- Tests added for business logic where feasible.
- Documentation updated with the code.
