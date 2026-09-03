# PhotoX V4 Run 15 — Web reconnect resilience

## Scope

Continue only on `v4` from the latest branch state. Preserve `v3` unchanged and avoid redoing the already completed Web ticket bootstrap, HTTP 401 refresh/retry, authenticated WebSocket reconnect, Google Drive quota allocation, and Google Photos migration work.

## Analysis

The shared Desktop/Web HTTP bridge already had automated coverage for:

- one-time Web ticket bootstrap before protected requests;
- automatic HTTP `401 -> refresh -> retry` with the rotated access token;
- WebSocket reconnect using a refreshed access token.

A remaining reliability gap existed in the WebSocket reconnect path: if the refresh endpoint temporarily failed during reconnect (for example, a transient network outage or 5xx), the bridge cleared the access token and stopped trying. The browser could therefore remain permanently disconnected until a reload even though the refresh session later became usable again.

## Completed

- Hardened the shared HTTP/WebSocket `DesktopBridge` reconnect lifecycle.
- WebSocket close now schedules a reconnect that refreshes credentials before opening the next socket.
- A transient refresh failure no longer terminates reconnect attempts.
- Added bounded exponential reconnect backoff starting at 1.5 seconds and capped at 30 seconds.
- Successful WebSocket `open` resets the reconnect backoff.
- Unsubscribe still cancels the retry timer and closes the active socket.
- Added a renderer-level regression test proving a failed refresh is retried and a later successful refresh reconnects with the rotated access token.
- Existing one-time ticket and HTTP `401 -> refresh -> retry` tests remain enabled.

## Validation

The code batch passed the standard repository CI path on `v4`:

- `npm install` — PASS
- `npm test` — PASS
- `npm run typecheck` — PASS
- `npm run build` — PASS

Native signed binaries are outside this Linux CI path and remain explicitly NOT VERIFIED here.

## Priority requirements carried forward

1. Google Drive allocation remains proportional, not a fixed 10 GiB cap: default PhotoX allocation is `2/3` of authoritative provider total quota, still constrained by actual provider remaining bytes and safety reserve, with per-account ratio override.
2. Google Photos migration remains compliant with the current Picker API for source selection and append-only Google Photos or connected Google Drive destinations; no unrestricted full-library crawling is advertised or implemented.
3. Web continues to use the exact shared Desktop React renderer via `DesktopBridge`, with JOSE workspace sessions, HttpOnly refresh cookie, CSRF protection, role enforcement, WebSocket auth, audit, and workspace-bound Range streaming.

## Next prioritized batch

1. Move migration transfer speed/ETA from renderer-only sampling into shared migration progress logic so Desktop and Web consume the same authoritative telemetry and reconnect/reload does not temporarily lose the estimate.
2. Add focused shared UI/browser smoke coverage for migration progress and signed media playback behavior on top of the existing transport/bridge tests.
3. Build workspace/plan/usage and device/session management APIs plus real shared Desktop/Web/Mobile UX, using existing workspace persistence and entitlements rather than mock controls.
4. Continue central SaaS control-plane extraction for multi-edge workspace routing, subscription snapshots, authoritative SaaS-issued sessions, operations visibility, and billing-ready abstractions.
5. Run live Google Photos OAuth migration verification outside CI when real user consent/credentials are available.

## Verification limitations

- Live Google Photos -> Google Photos / Google Drive transfer with real OAuth accounts: NOT VERIFIED in CI.
- iOS signed IPA/Xcode release build: NOT VERIFIED in this environment.
- Android signed release APK/AAB: NOT VERIFIED in this environment.
