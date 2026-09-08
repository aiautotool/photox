# PhotoX V4 Run 53 — Mobile viewer navigation completion

## Starting point

- Continued from the latest `v4` state after the SQLite-authoritative media repair batch.
- `v3` remains intentionally untouched.
- The three SaaS P0 contracts remain unchanged: Google Drive allocation uses the per-account ratio over authoritative total quota and actual provider remaining capacity; Google Photos migration is Picker-selected only with append-only Google Photos destination behavior; Web/Desktop continue to share the React UI and `DesktopBridge` contract.

## Analysis

The implementation plan still listed asset-indexed viewer state, horizontal swipe, pinch/double-tap zoom and neighbor preload as open. Source inspection showed that `SwipeMediaStage.tsx` already had:

- asset-indexed previous/current/next selection;
- photo horizontal swipe;
- pinch zoom and double-tap zoom/reset for photos;
- adjacent photo prefetch;
- video loading/error/retry backed by `expo-video`.

The real incomplete path was video navigation: the video wrapper had an empty `onTouchEnd` handler, so sequential viewer navigation stopped being gesture-complete whenever the current asset was a video.

## Implementation

`mobile/src/viewer/SwipeMediaStage.tsx` now:

- uses one horizontal-swipe classifier for photo and video navigation;
- records single-touch start/end coordinates around video playback;
- moves to the previous/next asset only for a sufficiently horizontal gesture (`64px` minimum and horizontal dominance), reducing accidental navigation during taps or vertical gestures;
- clears gesture state on asset changes, cancellation and multi-touch;
- preserves native `VideoView` controls, fullscreen and Picture-in-Picture behavior;
- keeps photo swipe disabled while zoomed so panning a zoomed image does not accidentally navigate.

No mock viewer controls were added.

## Plan delta

The current viewer implementation now backs these previously-open plan items with real behavior:

- asset-indexed viewer state — implemented;
- horizontal swipe left/right across photos and videos — implemented;
- pinch and double-tap zoom for photos — implemented;
- neighbor photo preload — implemented.

A later documentation consolidation pass should fold these statuses into `docs/IMPLEMENTATION_PLAN.md`; this run records the authoritative implementation delta without rewriting unrelated plan history.

## Verification requirements

This batch must not be considered complete until the repository CI on the final `v4` HEAD passes the existing repository tests, TypeScript typecheck and production build gates. Native signed/device release builds remain separate acceptance work.

## Remaining risks / NOT VERIFIED

- Native gesture feel with `VideoView` controls on physical iOS/Android devices — NOT VERIFIED.
- iPhone MOV/HEVC full acceptance on a physical device — NOT VERIFIED.
- Live Google Drive allocation mutation against a real Google account — NOT VERIFIED.
- Live Google Photos Picker/destination migration against real accounts — NOT VERIFIED.
- Real TLS reverse-proxy deployment acceptance — NOT VERIFIED.

## Next prioritized batch

With the viewer navigation gap closed, prioritize durable mobile upload restart/network-resume behavior or another production-safe incomplete item that can be fully CI-gated without requiring live provider credentials or release signing. Preserve all current SaaS P0 contracts and avoid redoing completed SQLite, Drive allocation, Google Photos migration, Web bridge or viewer work.
