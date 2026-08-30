# @photox/media-api

Framework-neutral contracts/services for the PhotoX Desktop media API.

## Responsibilities

- Stable public `MediaDTO` for Mobile/Desktop UI.
- Cursor-based media listing.
- Media detail aggregation from media index + cloud catalog + edit/sync state.
- Thumbnail/preview/original content contracts.
- HTTP Range passthrough for video streaming.
- Authorization scopes and access-token contracts.
- Pairing credential exchange into short-lived access sessions.

## Suggested endpoints

```text
POST /api/v1/auth/pair/exchange
POST /api/v1/auth/refresh
POST /api/v1/auth/revoke
GET  /api/v1/media
GET  /api/v1/media/:id
GET  /api/v1/media/:id/thumbnail
GET  /api/v1/media/:id/preview
GET  /api/v1/media/:id/content
GET  /api/v1/media/:id/replicas
```

## JWT / JWS

The core package does not depend on a JWT implementation. Desktop should implement `AccessTokenIssuer` and `AccessTokenVerifier`, preferably with a maintained JOSE library such as `jose`.

Recommended production model:

```text
QR pairing / pair code
→ exchange once
→ short-lived JWT access token (~15 min)
→ refresh token/session stored securely
→ rotate/revoke session when needed
```

Suggested JWT claims:

```text
iss photox-desktop
sub paired-device/user
sid session id
did device id
scope media:read media:download cloud:read
iat issued at
exp expiry
aud photox-mobile
jti unique token id
```

Never put Google tokens, Telegram bot tokens, local paths or provider credentials inside JWT payloads.

For a single local LAN connection, a random opaque session token is also valid. JWT becomes especially useful for tunnel/internet access, multiple devices, expiration, scopes and revocation tracking.
