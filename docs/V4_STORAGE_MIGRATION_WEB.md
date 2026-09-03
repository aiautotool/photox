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
- one-time Web login ticket issued only by trusted Desktop, held in process memory, expiring after 2 minutes, and consumable exactly once;
- browser bootstrap reads only `#ticket=...`, strips the fragment immediately, redeems the ticket, and receives only short-lived access + CSRF state;
- the reusable refresh token is written directly to an HttpOnly `SameSite=Strict` cookie by the edge server and is not returned to browser JavaScript in the normal login flow;
- legacy `/api/web/v1/auth/bootstrap` refresh-token bootstrap remains temporarily only for compatibility with older V4 deployments;
- refresh endpoint (`POST /api/web/v1/auth/refresh`) that reads only the HttpOnly cookie, session introspection (`GET /api/web/v1/session`) and revoke endpoint (`POST /api/web/v1/auth/revoke`);
- a readable CSRF cookie plus required `x-csrf-token` header for refresh and all authenticated mutation routes; the CSRF cookie is scoped to `/` so browser reloads keep mutation/refresh capability;
- refresh cookies gain `Secure` when the configured public URL or trusted reverse-proxy scheme is HTTPS;
- browser JavaScript persists only the short-lived access token for reload convenience;
- browser HTTP adapter automatically refreshes an expired access token once and retries the failed API call;
- browser WebSocket reconnect uses the refreshed access token and the server authenticates the socket before upgrade;
- owner/admin/member/viewer route enforcement based on the verified workspace role;
- status, library, backup health, cloud upload, Drive account, Google Photos account and migration APIs;
- per-IP request rate limiting and explicit credential-aware CORS origin checks;
- CSP, frame denial, no-sniff and no-referrer response hardening;
- original/playback/thumbnail routes with existing byte Range streaming;
- short-lived HMAC-signed media URLs bound to `workspaceId + variant + media key + expiry`; the HMAC signing key is process-random and separate from the user's bearer token;
- media streaming resolves the media row inside the verified/signed workspace, preventing a signed URL for workspace A from resolving workspace B's item with the same key;
- Google Photos OAuth account credential files are namespaced by workspace and legacy unscoped credential files are migrated into the legacy workspace; accounts belonging to another workspace are ignored by the service;
- migration job lookup continues to require the job's stored `workspaceId` to match the service workspace;
- successful Web administrative/member mutations append durable audit events using identity from the verified principal, including actor user, device, session, role and workspace.

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
- [x] Namespace Google Photos OAuth account credential persistence by workspace and migrate legacy unscoped credentials into the legacy workspace.
- [x] Reject migration job access when stored `workspaceId` does not match the active migration service workspace.
- [x] Add runner-level expected-workspace guard and automated test proving a cross-workspace job is rejected before transfer or ledger mutation.
- [x] Validate append-capable Google Photos destination before Picker selection and reject source=destination migrations.

Remaining migration hardening:

- [ ] Add explicit filesystem-level cross-tenant tests around Google Photos credential migration/account visibility.
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
- [x] Move browser refresh-session persistence from JavaScript storage to HttpOnly/SameSite cookie after bootstrap.
- [x] Add CSRF double-submit protection for refresh and authenticated mutation routes.
- [x] Add server-side workspace-role enforcement and authenticated WebSocket upgrade.
- [x] Add workspace-bound signed browser media URLs and preserve Range streaming.
- [x] Add basic request rate limiting and response security headers.
- [x] Replace the transitional URL-fragment refresh credential with a one-time Web pairing/login ticket that directly establishes the cookie session.
- [x] Persist audit events for Web administrative/member mutations with authenticated user/device/session/workspace identity.
- [ ] Add reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx.
- [ ] Add browser end-to-end smoke test for parity-critical routes, cookie refresh, CSRF, WebSocket and Range streaming.

## Next priorities

1. Add browser E2E parity coverage for ticket login, cookie refresh, CSRF, WebSocket reconnect and signed Range streaming.
2. Add filesystem-level cross-tenant Google Photos credential/account visibility tests.
3. Add reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx.
4. Large-file streaming + mid-file Google Drive migration resume.
5. Continue central control-plane extraction for multi-edge workspace routing, subscription state and SaaS-issued sessions.

## Validation rule

Every batch must pass repository tests, TypeScript typecheck and production build before being marked complete. Live Google OAuth transfer remains explicitly NOT VERIFIED in CI because user OAuth credentials/consent are not available there.

## Web one-time login ticket hardening

- Desktop issues a cryptographically random Web login ticket with a 2-minute TTL.
- The ticket is single-use and held only in process memory; a successful or expired consume removes it.
- Browser bootstrap accepts `#ticket=...`, removes the fragment immediately, redeems it at `/api/web/v1/auth/ticket`, and receives only the short-lived access token + CSRF token.
- The reusable refresh token is written directly to the existing HttpOnly/SameSite cookie by the edge server and is never returned to browser JavaScript in the normal Web login flow.
- Desktop Settings exposes a real `Tạo & sao chép` Web link action; the Web transport itself cannot mint login links.
- `OneTimeTicketStore` has automated tests proving one-time consumption and expiry behavior.

Verification marker: one-time ticket implementation passed its integration workflow with `npm install`, `npm test`, full repository typecheck and full production build before commit.

## Run 10 — Web mutation audit + migration tenant defense

Completed:

- Web administrative/member mutations now append durable workspace audit events after successful execution.
- Audit actor identity is taken from the verified JOSE principal (`subject`, `deviceId`, `sessionId`, workspace role), never from request JSON.
- Google Drive/Google Photos provider mutations, cloud retry, migration lifecycle actions, local-library open and session revoke are audited with target metadata where available.
- `GooglePhotosMigrationRunner` now accepts an expected workspace boundary and refuses a ledger job from another workspace before changing job/item state or invoking a transfer adapter.
- Desktop migration always supplies its workspace ID to the runner.
- Google Photos -> Google Photos selection validates the append-capable destination account before opening Picker and rejects source=destination to avoid accidental duplicate import into the same account.
- Automated migration test proves cross-workspace runner execution is rejected without touching the transfer adapter or ledger state.
- The integration validation passed install, tests, full typecheck and full production build before the code commit was pushed.

Still pending:

- browser-level E2E coverage for ticket login, refresh cookie, CSRF, WebSocket reconnect and Range streaming;
- filesystem-level cross-tenant Google Photos credential/account visibility tests;
- reverse-proxy deployment recipes (Cloudflare/Caddy/nginx);
- streaming Google Photos downloads and resumable mid-file Drive migration checkpoints;
- live Google OAuth migration verification with user credentials.
