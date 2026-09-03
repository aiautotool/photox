# PhotoX V4 — Run 15: Web ticket-first bootstrap hardening

## Analysis

The current Web bridge accepted the new one-time `loginTicket`, but its first protected HTTP request and first WebSocket subscription only called `bootstrapSession()` when a legacy bootstrap refresh token was present. A normal ticket-only login could therefore call `/auth/refresh` before the server had ever received the ticket and before the HttpOnly refresh cookie existed.

## Implementation

- Ticket-only Web sessions now redeem the one-time ticket before any refresh attempt for both HTTP API calls and WebSocket subscription startup.
- Legacy refresh bootstrap remains supported for compatibility, but no longer controls whether the new ticket path is entered.
- Added a renderer-bridge regression test that starts with only a login ticket, proves `/auth/ticket` is called first, proves `/auth/refresh` is not called first, and verifies the resulting access token is used on the protected status request.
- Added a dedicated renderer test TypeScript target and wired it into the Desktop test command so the regression is part of repository CI.

## Validation requirement

This run is complete only when repository tests, full TypeScript typecheck, full production build, and standard GitHub CI are green on the final `v4` HEAD. Signed iOS/Android builds and live Google OAuth transfers remain `NOT VERIFIED` unless their platform credentials are available.

## Next priorities

1. Extend renderer-level Web coverage to automatic `401 -> refresh -> retry` and WebSocket reconnect behavior.
2. Add durable transfer speed/ETA metrics to Google Photos migration progress and the shared Desktop/Web UI.
3. Add a live OAuth migration verification harness for real Google accounts outside CI.
4. Continue central SaaS control-plane extraction and workspace/member/device/quota operations UX.
