# V4 Run 070 — Relay resumable tunnel foundation

## Scope completed

This run continues directly from Run 069 and prepares relay transport for byte-offset resumable Mobile -> Desktop uploads without changing Desktop storage authority.

### Desktop tunnel

- Added `resumableTunnelProxy.ts` as a strict production proxy boundary for relay resumable requests.
- Only the existing resumable namespace is accepted:
  - `POST /api/v1/media/uploads`
  - `GET /api/v1/media/uploads/:sessionId`
  - `PATCH /api/v1/media/uploads/:sessionId/chunks`
  - `POST /api/v1/media/uploads/:sessionId/finalize`
- Relay requests must carry the Desktop pairing token and the tunnel validates it against the local tunnel identity before forwarding anything to the local receiver.
- Only allowlisted PhotoX/auth headers are forwarded; relay routing/pair-token metadata is not forwarded into the receiver authority boundary.
- Request and response bodies are bounded. A relay request can hold one upload chunk in memory, never the entire media asset.
- Desktop response status/body are preserved, including authoritative `409 UPLOAD_OFFSET_MISMATCH` reconciliation responses.
- `PhotoSyncTunnelClient` now handles `resumable.request` messages and returns `resumable.response` messages.
- `internetTunnel.ts` wires this protocol to the already production-mounted local receiver on port 43117.

### Relay

- Added `ResumableRelayBroker`.
- `/api/v1/media/uploads*` is now brokered over the authenticated Desktop WebSocket tunnel when `x-photosync-relay-desktop-id` and `x-photosync-pair-token` are present.
- Broker state is intentionally ephemeral and request-scoped. It does not own upload sessions, quota, media bytes, hashes, or finalization state.
- Request body size, response body size and response timeout are configurable via environment variables.
- When the Desktop tunnel disconnects, all in-flight broker requests for that Desktop resolve with `503` instead of hanging until timeout.
- Relay health now exposes `pendingResumableRequests`.
- CORS preflight now includes PATCH for resumable chunks.
- The legacy whole-file `/api/v1/upload/:desktopId` route remains unchanged for compatibility during rollout.

## Authority and restart invariant

Desktop remains authoritative for resumable session identity, acknowledged byte offset, workspace quota reservation, finalize ownership, SHA-256 verification, media catalog commit and post-commit processing.

The relay therefore does not need a durable upload ledger and does not buffer an entire file. If the relay restarts or the WebSocket drops, only the in-flight request is lost. The Mobile client can retry, query the Desktop session status through the relay, receive the authoritative `acknowledgedBytes`, and continue from that offset.

## Validation

CI run 956 on code HEAD `54376f60316f685ccafb40495248e1dad7056deb` completed successfully:

- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop application smoke: PASS

Desktop regression coverage added in this run verifies create forwarding, PATCH binary forwarding, preservation of authoritative 409 offset reconciliation, invalid pairing-token rejection, route isolation and request-size bounds.

Local clone/test/build remains NOT VERIFIED in the automation execution environment because `github.com` DNS resolution is unavailable there; GitHub Actions is the authoritative validation path for this run.

## P0 requirements carried forward

1. Google Drive allocation remains quota-derived, never a fixed 10 GiB cap: default PhotoX allocation is 2/3 of each account's authoritative total provider quota, additionally bounded by actual provider remaining bytes and safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains compliant with the current Picker API: user-selected source media only, append-only transfer to another Google Photos account or connected Google Drive account, durable ledger/progress/pause/resume/retry/verification/account selection/real UI, and no unrestricted full-library crawling claims.
3. Web/Desktop remain one React UI/component/style system through the shared DesktopBridge contract with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure and secure public access controls.

## Remaining risk before enabling relay resumable on Mobile

The transport tunnel is now available, but Mobile must not switch relay mode to resumable yet. Modern workspace access tokens are currently paired/refreshed through direct receiver/public auth endpoints. A relay-only device can therefore reach a point where its bearer token expires but has no relay path for `/api/v1/auth/pair` or `/api/v1/auth/refresh`.

Enabling relay resumable before closing that gap could turn a recoverable network transition into an authentication dead end. The legacy whole-file relay route remains the compatibility path until relay-auth forwarding is implemented and tested.

## Next prioritized batch

1. Add strict relay forwarding for workspace auth pair/refresh/revoke with the same Desktop identity and bounded-body controls; never expose unrestricted receiver proxying.
2. Teach Mobile pairing/session refresh to use the relay auth adapter when direct receiver/public access is unavailable.
3. Enable relay resumable in `UploadTransportPolicy` only for modern authenticated pairings; preserve legacy v1 whole-file compatibility.
4. Add end-to-end integration regressions for relay restart, token refresh, session status resume and `409` offset reconciliation.
5. After relay resumable rollout is green, harden authoritative multi-member user attribution for resumable audit records.

Signed IPA/APK/AAB, signed Windows/macOS installers, physical Android/iOS process-kill/network-loss acceptance, live Google Drive/Google Photos acceptance, real public TLS/reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.
