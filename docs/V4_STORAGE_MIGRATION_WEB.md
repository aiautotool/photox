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
5. User selects destination:
   - another Google Photos account authenticated with `photoslibrary.appendonly`; or
   - any connected Google Drive account.
6. Desktop uploads with resumable/retry logic where supported.
7. Destination object is verified before the migration item is marked complete.
8. Migration ledger persists source item ID, filename, target provider/account, state, bytes, attempts, error and destination ID.
9. Failed items are retryable without repeating completed items.
10. Picker session is deleted after completion/expiry.

The same source Picker flow supports both Google Photos -> Google Photos and Google Photos -> Google Drive.

## Desktop UX

Add a top-level `Migration` / `Chuyển dữ liệu` page with:

- Source: Google Photos account + connect/select media.
- Destination: Google Photos or Google Drive account.
- selected photo/video count and estimated bytes when known.
- current filename, transferred bytes, batch progress, speed and ETA.
- queued/running/completed/failed/cancelled states.
- pause/resume/cancel/retry failed.
- migration history with per-item detail.
- no destructive source delete by default.

No control is shown as active until its backing API/worker path exists.

## Web app parity

The web edition must reuse the exact React UI tree and CSS used by Electron. There should not be a separately redesigned admin web app.

Target architecture:

`desktop React UI -> DesktopBridge interface -> Electron IPC adapter OR authenticated HTTP/WebSocket adapter`

Rules:

- Electron and Web use the same `App.tsx`, routes, components and styling.
- Browser mode replaces Electron IPC with an HTTP/WebSocket bridge to the desktop/edge service.
- The service binds to a configurable host/port.
- Default bind remains loopback/LAN-safe; public exposure is explicit.
- Reverse proxy/domain/TLS are supported (Cloudflare Tunnel, nginx, Caddy, etc.).
- Public web access requires workspace/session authentication; the existing long-lived pair code must not become a public web admin password.
- CORS allowlist, CSRF protection for cookie mode, rate limiting, audit events and websocket authentication are required before public exposure is marked production-ready.
- Media streaming keeps Range support.
- Browser UI must have feature parity with desktop except OS-only actions (for example opening Finder/Explorer), which get an explicit web-safe alternative.

## Implementation batches

### Batch A — implemented foundation

- [x] Replace fixed 10 GiB allocation with default 2/3 of provider total quota.
- [x] Pass Google `storageQuota.limit` into the allocator on Desktop.
- [x] Unit tests for proportional quota, safety reserve and per-account override.
- [x] Add `@photosync/google-photos` package.
- [x] Implement Picker session create/get/delete/list helpers.
- [x] Implement selected-media download helpers.
- [x] Implement Google Photos append-only upload + batchCreate helpers.
- [x] Add generic selected-media transfer worker with per-item success/failure results.
- [x] Add package tests and include package in root test/typecheck/build commands.

### Batch B — in progress

- [ ] Persist Google Photos OAuth accounts separately from Google Drive accounts.
- [x] Add migration job/item domain and state machine with pause/cancel/resume/retry-safe behavior.
- [x] Add migration ledger + resumable state in SQLite.
- [x] Persist item attempts, transferred bytes, target ID/URL and per-item errors.
- [ ] Add Desktop IPC migration service and progress events.
- [ ] Add Migration page to the shared Desktop/Web UI.
- [ ] Wire Google Photos -> Google Photos destination.
- [ ] Wire Google Photos -> Google Drive resumable destination.
- [ ] Verify destination checksums/size where APIs permit.

### Batch C — Web parity

- [x] Extract the renderer bridge contract from `App.tsx`.
- [x] Make the existing renderer resolve Electron or Web transport without forking the React UI tree.
- [x] Keep Electron IPC adapter.
- [x] Add authenticated HTTP/WebSocket adapter contract/client; server endpoints and auth enforcement remain pending.
- [ ] Expose desktop status/library/accounts/health/migration/jobs APIs through the edge service.
- [ ] Serve the same Vite production bundle from the edge service.
- [ ] Add configurable bind host/port/base URL/domain/CORS origins.
- [ ] Add SaaS workspace authentication and role enforcement for web admin actions.
- [ ] Add reverse-proxy deployment examples for Cloudflare Tunnel, Caddy and nginx.
- [ ] Add browser end-to-end smoke test for parity-critical routes.

## Validation note

The migration ledger + shared bridge integration was validated with the repository's full unit/integration test command, TypeScript typecheck and production build before commit. The build order now compiles `@photosync/google-photos` before `@photox/persistence-sqlite`, which consumes its migration contracts.

Every batch must pass unit tests, TypeScript typecheck and production build before being marked complete.
