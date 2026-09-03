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
- JOSE access tokens and durable refresh sessions issued by the same workspace session service used by Mobile; the old static `PHOTOX_WEB_ACCESS_TOKEN`, env-bound role and env-bound Web authorization path are removed;
- workspace ID, role, device ID and session ID taken from a verified access-token principal rather than client configuration;
- membership and device revocation checks on every authenticated Web/API/WebSocket request;
- refresh endpoint (`POST /api/web/v1/auth/refresh`), session introspection (`GET /api/web/v1/session`) and revoke endpoint (`POST /api/web/v1/auth/revoke`);
- browser HTTP adapter automatically refreshes an expired access token once and retries the failed API call;
- browser WebSocket reconnect uses the refreshed access token and the server authenticates the socket before upgrade;
- owner/admin/member/viewer route enforcement based on the verified workspace role;
- status, library, backup health, cloud upload, Drive account, Google Photos account and migration APIs;
- per-IP request rate limiting and explicit CORS origin checks;
- CSP, frame denial, no-sniff and no-referrer response hardening;
- original/playback/thumbnail routes with existing byte Range streaming;
- short-lived HMAC-signed media URLs bound to `workspaceId + variant + media key + expiry`; the HMAC signing key is process-random and separate from the user's bearer token;
- media streaming resolves the media row inside the verified/signed workspace, preventing a signed URL for workspace A from resolving workspace B's item with the same key;
- access and refresh credentials may be provisioned through the URL fragment for the current transitional Web handoff and are immediately copied to `sessionStorage` before the fragment is stripped from browser history.

The edge no longer treats a long-lived static string as administrator identity. Remaining production hardening is to replace the transitional fragment/sessionStorage credential handoff with a first-class browser pairing/login UX and preferably an HttpOnly refresh-cookie flow, then move issuance to the central SaaS control plane when that service is deployed.

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
- [x] Replace static Web admin token/role/workspace config with verified JOSE workspace sessions.
- [x] Add automatic browser access-token refresh and session revoke API.
- [x] Add server-side workspace-role enforcement and authenticated WebSocket upgrade.
- [x] Add workspace-bound signed browser media URLs and preserve Range streaming.
- [x] Add basic request rate limiting and response security headers.
- [ ] Add first-class browser pairing/login UX and HttpOnly refresh-cookie handoff.
- [ ] Persist audit events for Web administrative actions with the authenticated actor/session.
- [ ] Namespace Google Photos OAuth account persistence and every migration operation by workspace principal rather than the current single-edge workspace service instance.
- [ ] Add reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx.
- [ ] Add browser end-to-end smoke test for parity-critical routes.

## Next priorities

1. First-class Web pairing/login handoff and HttpOnly refresh cookie; remove fragment/sessionStorage refresh-token dependency.
2. Scope Google Photos OAuth accounts + migration job service by authenticated workspace and add cross-tenant tests.
3. Persist Web administrative audit events using authenticated user/device/session identity.
4. Browser E2E parity test and reverse-proxy deployment docs.
5. Large-file streaming + mid-file Google Drive migration resume.
6. Continue central control-plane extraction for multi-edge workspace routing, subscription state and SaaS-issued sessions.

## Validation rule

Every batch must pass repository tests, TypeScript typecheck and production build before being marked complete. Live Google OAuth transfer remains explicitly NOT VERIFIED in CI because user OAuth credentials/consent are not available there.
