# PhotoX V4 — Storage policy, Google Photos migration, Web parity

## Google Drive allocation policy

V4 no longer uses a fixed 10 GiB cap per Google account.

Default rule for each Google Drive account:

`PhotoX managed bytes <= floor(provider total quota * 2 / 3)`

The allocator must also respect Google's actual remaining bytes and keep the existing provider reserve. Effective writable bytes are the minimum of:

- remaining bytes inside the PhotoX allocation; and
- actual provider free bytes minus safety reserve.

The ratio is configurable per account (`maxUsageRatio`) and defaults to `2/3`. Google Drive `about.storageQuota.limit` is authoritative total quota when present; `storageQuota.usage` is total usage across Google services.

## Google Photos migration constraints

Since March 31, 2025 Google removed unrestricted full-library readonly access for third-party apps. PhotoX must not advertise or implement automatic full-library crawling.

Supported compliant flow:

1. Source account authenticates with Google Photos Picker scope.
2. Desktop creates a Picker session.
3. User selects media inside Google Picker.
4. Desktop lists/downloads only selected media while the Picker session is valid.
5. Destination is another Google Photos account authenticated with append-only scope, or a connected Google Drive account.
6. Desktop uploads with resumable/retry behavior where supported.
7. Destination is verified before an item is complete.
8. Durable ledger stores source item, filename, destination, state, bytes, attempts, error and destination ID.
9. Failed items retry without repeating completed items.
10. Picker sessions are removed after terminal completion/expiry where possible.

## Desktop UX

The shared Desktop/Web renderer exposes `Chuyển dữ liệu` with real account selection, Picker selection, job/item progress, pause/resume/cancel/retry and migration history backed by SQLite.

## Web app parity

Electron and browser reuse the same React tree and CSS:

`desktop React UI -> DesktopBridge -> Electron IPC OR authenticated HTTP/WebSocket edge service`

Current Web edge behavior:

- same Vite production bundle as Desktop;
- configurable host, port, public base URL, allowed origins and rate limit;
- disabled by default and loopback bind by default;
- JOSE access tokens and durable workspace refresh sessions shared with Mobile auth;
- workspace ID/role/device/session/scopes derived from verified principals;
- membership/device revocation checks on authenticated requests;
- one-time Web login ticket created only by trusted Desktop, held in memory, 2-minute TTL, single-use;
- browser exchanges only `#ticket=...`, removes fragment immediately, then receives short-lived access + CSRF state;
- reusable refresh token is stored directly in HttpOnly `SameSite=Strict` cookie and not returned to normal browser JavaScript;
- legacy refresh bootstrap remains temporarily for old V4 deployments only;
- CSRF double-submit protection on refresh and authenticated mutations;
- refresh cookie gains `Secure` when final public URL/reverse-proxy scheme is HTTPS;
- browser bridge refreshes access token once on 401 and retries;
- authenticated WebSocket upgrade and workspace-filtered events;
- owner/admin/member/viewer server-side role enforcement;
- per-IP rate limiting, credential-aware CORS and security response headers;
- workspace-bound signed media URLs and byte Range streaming;
- Google Photos credential files namespaced by workspace;
- migration job lookup and runner execution guarded by workspace;
- successful Web administrative mutations append durable audit identity from verified principal.

## Implementation batches

### Batch A — storage/migration foundation

- [x] Replace fixed 10 GiB allocation with default 2/3 provider total quota.
- [x] Pass Google `storageQuota.limit` into Desktop allocator.
- [x] Tests for proportional quota, provider reserve and per-account override.
- [x] Add compliant Google Photos Picker/append-only helpers.
- [x] Add selected-media transfer worker with per-item results.

### Batch B — desktop Google Photos migration

- [x] Separate Google Photos OAuth accounts from Google Drive accounts.
- [x] Durable migration ledger/job/item state machine.
- [x] Desktop IPC service and shared renderer UI.
- [x] Google Photos -> Google Photos append-only path.
- [x] Google Photos -> Google Drive resumable upload path.
- [x] Verify Google Drive destination ID and byte size.
- [x] Pause/resume/cancel/retry without repeating completed items.
- [x] Namespace Google Photos credentials by workspace.
- [x] Reject job access and runner execution across workspace boundary.
- [x] Validate append-capable destination and reject source=destination.
- [x] Add filesystem-level cross-tenant credential tests.
- [x] Prevent a non-legacy workspace from claiming an old unscoped Google Photos credential file; only the configured legacy workspace may migrate those files.

Remaining migration hardening:

- [ ] Stream/chunk very large Google Photos source files instead of buffering the whole item in memory.
- [ ] Persist Drive upload-session/chunk checkpoint for true mid-file resume after process restart.
- [ ] Add transfer speed and ETA metrics.
- [ ] Add real-Google-account end-to-end verification outside CI with OAuth credentials/consent.

### Batch C — Web parity/security

- [x] Shared renderer bridge contract.
- [x] Electron IPC + authenticated HTTP/WebSocket adapters.
- [x] Expose status/library/accounts/health/migration through edge APIs.
- [x] Serve same Vite production bundle.
- [x] Configurable bind host/port/public base URL/CORS origins.
- [x] Replace static Web admin token/role/workspace config with JOSE workspace sessions.
- [x] Automatic browser access-token refresh and revoke API.
- [x] HttpOnly/SameSite refresh cookie.
- [x] CSRF protection.
- [x] Server-side roles + authenticated WebSocket.
- [x] Workspace-bound signed media URLs and Range streaming.
- [x] Basic rate limiting/security headers.
- [x] One-time Desktop-issued Web login ticket.
- [x] Durable audit events for Web administrative mutations.
- [x] Reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx updated for the current session/cookie/CSRF model.
- [x] Node transport integration coverage for one-time ticket replay protection, HttpOnly/CSRF cookies, mutation CSRF, refresh, authenticated WebSocket delivery and workspace-bound signed HTTP Range `206` streaming.
- [ ] Browser-renderer end-to-end smoke test for automatic access refresh, WebSocket reconnect and UI/media behavior.

## Next priorities

1. Add browser-renderer E2E coverage for automatic access refresh, WebSocket reconnect and shared Desktop/Web UI behavior on top of the now-covered HTTP/WebSocket transport.
2. Stream large Google Photos downloads and persist Google Drive mid-file resumable checkpoints.
3. Add transfer speed/ETA and live OAuth migration verification harness.
4. Continue central control-plane extraction for multi-edge workspace routing, subscription state and SaaS-issued sessions.
5. Continue workspace/device/member/quota UX and operations visibility across Desktop/Web/Mobile.

## Validation rule

Every code batch must pass repository tests, TypeScript typecheck and production build before it is marked complete. Platform-specific signed installers and live Google OAuth transfer are reported `NOT VERIFIED` when the required environment/credentials are unavailable.

## Run 11 — Google Photos credential isolation + deployment hardening

Completed:

- Found and fixed a tenant migration edge case: an unscoped legacy Google Photos credential could previously be adopted by whichever workspace scanned the shared credential directory first.
- `DesktopGooglePhotosMigrationService` now accepts the designated legacy workspace boundary and ignores unscoped legacy files from every other workspace.
- Added focused filesystem tests proving workspace B cannot list/remove workspace A credentials, a non-legacy workspace cannot claim an unscoped credential, and the legacy workspace migrates that credential with its workspace ID persisted.
- Wired these Desktop tests into the repository `npm test` path through a focused Electron test TypeScript build.
- Replaced stale Web deployment documentation that still described static access-token bootstrap with current one-time ticket + HttpOnly refresh + CSRF behavior.
- Added production recipes/checklists for Cloudflare Tunnel, Caddy and nginx, including WebSocket and Range-stream preservation.

Still pending:

- browser-level E2E coverage;
- large-file streaming and process-restart mid-file Drive resume;
- live Google OAuth migration verification;
- signed iOS/Android release verification.

## Run 12 — stable Web edge transport integration coverage

Completed:

- Added a loopback integration test that boots the real `PhotoXWebEdgeServer` on an ephemeral free port without Electron or a browser binary.
- The test redeems a Desktop-issued one-time ticket and proves ticket replay is rejected.
- It verifies refresh is held in an HttpOnly `SameSite=Strict` cookie, CSRF state is emitted separately, and mutation without CSRF is rejected before backing logic runs.
- It exercises a successful authenticated mutation with durable-audit callback, refresh-cookie flow, authenticated WebSocket event delivery, signed media URL generation and bearerless HTTP Range `206` streaming scoped to the authenticated workspace.
- Updated root test ordering to build SDK packages before Desktop transport tests, because `webEdgeServer.ts` imports the built `@photox/media-api` package. Standalone SDK tests remain available through `npm run test:sdk`.
- Repository CI passed `npm test`, full TypeScript typecheck and full production build with the new transport test enabled.

Still pending:

- browser-renderer E2E for automatic 401 refresh/retry, WebSocket reconnect and React UI behavior;
- large Google Photos source streaming and durable Google Drive mid-file resumable checkpoint;
- live Google OAuth migration verification;
- signed iOS/Android release verification.
