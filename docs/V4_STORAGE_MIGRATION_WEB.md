# PhotoX V4 — Storage policy, Google Photos migration, Web parity

## Google Drive allocation policy

V4 no longer uses a fixed 10 GiB cap per Google account.

Default rule for each Google Drive account:

`PhotoX managed bytes <= floor(provider total quota * 2 / 3)`

The allocator must also respect Google's actual remaining bytes and keep the existing provider reserve. Therefore effective writable bytes are the minimum of:

- remaining bytes inside the PhotoX 2/3 allocation; and
- actual provider free bytes minus safety reserve.

The ratio is configurable per account (`maxUsageRatio`) and defaults to `2/3`.

Google Drive `about.storageQuota.limit` is the authoritative total quota when present. `storageQuota.usage` is the total usage across Google services; PhotoX must not infer free space from Drive files alone.

## Google Photos migration constraints

Since March 31, 2025 Google removed full-library readonly access for third-party apps. PhotoX must not advertise or implement an automatic unrestricted crawl of a user's entire existing Google Photos library.

Supported compliant flow:

1. Source Google account authenticates with Google Photos Picker scope.
2. Desktop creates a Picker session.
3. User selects up to the Picker batch limit.
4. Desktop lists selected media and downloads the selected bytes while the Picker session is valid.
5. User selects destination: another Google Photos account authenticated with `photoslibrary.appendonly`, or any connected Google Drive account.
6. Desktop uploads with resumable/retry logic where supported.
7. Destination object is verified before the migration item is marked complete.
8. Migration ledger persists source item ID, filename, target provider/account, state, bytes, attempts, error and destination ID.
9. Failed items are retryable without repeating completed items.
10. Picker session is deleted after completion/expiry.

## Desktop UX

The shared Desktop/Web UI has a top-level `Chuyển dữ liệu` page backed by the real migration service with account selection, Picker selection, item/job progress, pause/resume/cancel/retry and migration history. Progress is refreshed from the durable SQLite ledger while work is running.

## Web app parity

Electron and browser reuse the exact same React tree and CSS:

`desktop React UI -> DesktopBridge -> Electron IPC OR authenticated HTTP/WebSocket edge service`

The Web edge implementation now provides:

- the same Vite production bundle served by the desktop edge process;
- configurable `PHOTOX_WEB_HOST`, `PHOTOX_WEB_PORT`, `PHOTOX_WEB_PUBLIC_BASE_URL` and `PHOTOX_WEB_ALLOWED_ORIGINS`;
- Web disabled by default and loopback bind by default;
- a dedicated `PHOTOX_WEB_ACCESS_TOKEN` with minimum 32 characters; pair-code is never reused as Web admin auth;
- owner/admin/member/viewer route enforcement;
- status, library, backup health, cloud upload, Drive account, Google Photos account and migration APIs;
- authenticated WebSocket events for migration/storage/file/tunnel updates;
- per-IP request rate limiting and explicit CORS origin checks;
- CSP, frame denial, no-sniff and no-referrer response hardening;
- original/playback/thumbnail routes with existing byte Range streaming;
- short-lived HMAC-signed media URLs so `<img>` and `<video>` can load without exposing the Web admin bearer token in media URLs;
- browser bootstrap token read from URL fragment and retained only in `sessionStorage`, so the fragment is removed before normal navigation/logging.

This is an edge-admin authentication layer, not yet the final SaaS identity provider. Workspace ID is bound to the edge config and role enforcement is server-side, but production SaaS user login, durable access/refresh sessions and centrally issued workspace claims remain P0 work.

## Implementation batches

### Batch A — implemented foundation

- [x] Replace fixed 10 GiB allocation with default 2/3 of provider total quota.
- [x] Pass Google `storageQuota.limit` into the allocator on Desktop.
- [x] Unit tests for proportional quota, safety reserve and per-account override.
- [x] Add `@photosync/google-photos` package and compliant Picker/append-only helpers.
- [x] Add generic selected-media transfer worker with per-item result handling.

### Batch B — implemented end-to-end desktop migration path

- [x] Separate Google Photos OAuth accounts from Google Drive accounts.
- [x] Durable migration ledger and job/item state machine.
- [x] Desktop IPC migration service and real shared renderer UI.
- [x] Google Photos -> Google Photos append-only path.
- [x] Google Photos -> Google Drive resumable upload path.
- [x] Verify Google Drive destination ID and byte size.
- [x] Pause/resume/cancel/retry without repeating completed items.

Remaining migration hardening:

- [ ] Stream/chunk very large Google Photos source files instead of buffering the entire item in memory.
- [ ] Persist Drive upload-session/chunk checkpoint for true mid-file resume after process restart.
- [ ] Add transfer speed and ETA metrics.
- [ ] Add real-Google-account end-to-end test outside CI with OAuth credentials and consent configuration.

### Batch C — Web parity

- [x] Extract shared renderer bridge contract.
- [x] Electron IPC and HTTP/WebSocket browser adapters share the same UI.
- [x] Expose desktop status/library/accounts/health/migration operations through edge APIs.
- [x] Serve the same Vite production bundle from the edge process.
- [x] Add configurable bind host/port/public base URL/CORS origins.
- [x] Add dedicated bearer authentication, server-side role enforcement and WebSocket authentication.
- [x] Add signed browser media URLs and preserve Range streaming.
- [x] Add basic request rate limiting and response security headers.
- [ ] Replace edge bootstrap token with central SaaS login + access/refresh workspace session.
- [ ] Persist audit events for Web administrative actions.
- [ ] Add reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx.
- [ ] Add browser end-to-end smoke test for parity-critical routes.

## Next priorities

1. Central SaaS workspace identity/session issuance and tenant-scoped edge authorization.
2. Durable workspace/membership/device/usage persistence and migration from legacy personal installs.
3. Audit log for Web/desktop administrative mutations.
4. Browser E2E parity test and reverse-proxy deployment docs.
5. Large-file streaming + mid-file Google Drive migration resume.

## Validation rule

Every batch must pass repository tests, TypeScript typecheck and production build before being marked complete. Live Google OAuth transfer remains explicitly NOT VERIFIED in CI because user OAuth credentials/consent are not available there.
