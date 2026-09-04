# PhotoX V4 Run 52 — Web reverse-proxy hardening

## Starting point

- Continued from V4 Run 51 without redoing Google Drive allocation UI/runtime work.
- Priority gap selected from `IMPLEMENTATION_PLAN.md`: production Web public-host/reverse-proxy hardening.
- `v3` is intentionally untouched.

## Analysis

`PhotoXWebEdgeServer` already had authenticated HTTP/WebSocket transport, CORS, CSRF, role checks, rate limiting, audit boundaries, signed media URLs and Range streaming. The remaining public-deployment trust gap was forwarded headers:

- `X-Forwarded-Proto` could influence secure-cookie state without proving the sender was a trusted reverse proxy.
- Rate limiting always used the immediate socket address, so all users behind a reverse proxy shared one bucket and `X-Forwarded-For` could not safely be used.
- Web runtime environment parsing did not reject malformed rate-limit/public-base/proxy settings early enough.

## Implementation

### Explicit reverse-proxy trust boundary

Added `desktop/electron/webProxyTrust.ts`:

- `PHOTOX_WEB_TRUSTED_PROXIES` accepts a comma-separated list of exact IP addresses.
- `loopback` expands to `127.0.0.1` and `::1` for same-host Nginx/Caddy/Traefik deployment.
- IPv4-mapped IPv6 peers are normalized.
- Hostnames and malformed entries fail configuration parsing rather than silently broadening trust.
- Forwarded headers are ignored unless the immediate socket peer is trusted.
- A trusted `X-Forwarded-For` chain is walked from the nearest hop backwards and rate limiting uses the nearest untrusted valid client address.
- `X-Forwarded-Proto` can mark a request HTTPS only when supplied through a trusted immediate proxy.

### Web edge integration

`desktop/electron/webEdgeServer.ts` now:

- carries optional `trustedProxyAddresses` in `WebEdgeConfig`;
- parses `PHOTOX_WEB_TRUSTED_PROXIES` at startup;
- applies trusted client identity to rate-limit buckets;
- prevents direct clients from spoofing HTTPS secure-cookie state;
- validates `PHOTOX_WEB_RATE_LIMIT` as finite/positive;
- validates `PHOTOX_WEB_PUBLIC_BASE_URL` as an absolute HTTP(S) URL without credentials/query/fragment.

Existing workspace auth, CSRF, CORS, role enforcement, WebSocket authentication, signed media URLs and media Range behavior remain unchanged.

## Regression coverage

Added:

- `webProxyTrust.test.ts` for normalization, invalid proxy entries, spoof resistance, trusted chains and malformed forwarded addresses;
- `webEdgeProxyHardening.test.ts` for startup validation, untrusted `X-Forwarded-Proto`, trusted HTTPS proxy behavior and separate client rate-limit identities behind one proxy;
- both suites are included in `desktop/tsconfig.electron-test.json`, so repository CI compiles and runs them.

## Documentation

Updated:

- `docs/IMPLEMENTATION_PLAN.md`;
- `docs/V4_BUILD_INTEGRATION_GUIDE.md`;
- `docs/V4_RELEASE_NOTES.md`.

The integration guide now documents `PHOTOX_WEB_TRUSTED_PROXIES`, recommended `PHOTOX_WEB_PUBLIC_BASE_URL`, fail-closed behavior, and the remaining requirement for real TLS reverse-proxy acceptance.

## Verification

GitHub Actions CI run 653 (`33927379229`) on commit `91a47b90a71686ca64f6eebe5569ca411e932a78` completed successfully:

- `npm install` — PASS
- repository tests — PASS
- `npm run typecheck` — PASS
- `npm run build` — PASS

Local repository execution remains unavailable in the current runtime because `github.com` cannot be resolved from the container; local checks are therefore not reported as PASS.

## Remaining risks / NOT VERIFIED

- Real TLS reverse-proxy deployment acceptance, including WebSocket upgrade and Range streaming through the actual proxy — NOT VERIFIED.
- Live Google Drive allocation mutation against a real Google account — NOT VERIFIED.
- Live Google Photos OAuth/migration with real accounts — NOT VERIFIED.
- Live Stripe E2E — NOT VERIFIED.
- Signed iOS IPA/Xcode and Android APK/AAB release builds — NOT VERIFIED.

## Next prioritized batch

Continue Web public-edge hardening without mock controls: apply the same trusted-client rate limit to WebSocket upgrade requests and add regression coverage for WebSocket origin/auth/rate behavior behind a trusted proxy. After that, if no live-provider credentials are available, move to the remaining P0 release/video acceptance items while preserving the three SaaS priority contracts.
