# PhotoX Web edge deployment

PhotoX V4 serves the exact same React/Vite UI used by Electron through the desktop edge process. Web mode is disabled by default.

## Required configuration

Use a random base64url secret of at least 32 characters for `PHOTOX_WEB_ACCESS_TOKEN`. Never reuse the mobile pair-code.

```bash
PHOTOX_WEB_ENABLED=true
PHOTOX_WEB_HOST=127.0.0.1
PHOTOX_WEB_PORT=43118
PHOTOX_WEB_ACCESS_TOKEN=<random-base64url-secret-at-least-32-chars>
PHOTOX_WEB_ROLE=owner
PHOTOX_WORKSPACE_ID=<workspace-id>
PHOTOX_WEB_PUBLIC_BASE_URL=https://photos.example.com
PHOTOX_WEB_ALLOWED_ORIGINS=https://photos.example.com
```

For direct LAN-only access, bind to a private interface or `0.0.0.0` only when the host firewall restricts the port to trusted networks. Public Internet exposure should terminate TLS at a reverse proxy/tunnel and keep PhotoX itself bound to loopback.

The first browser bootstrap can use the URL fragment so the token is not sent in the HTTP request URL:

```text
https://photos.example.com/#access_token=<token>
```

PhotoX immediately removes the fragment and retains the token only in browser `sessionStorage`. Closing the browser session removes it.

## Caddy

```caddyfile
photos.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:43118
}
```

Caddy handles HTTPS automatically when DNS points to the host. Keep `PHOTOX_WEB_ALLOWED_ORIGINS=https://photos.example.com`.

## nginx

```nginx
server {
  listen 443 ssl http2;
  server_name photos.example.com;

  ssl_certificate /etc/letsencrypt/live/photos.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/photos.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:43118;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_request_buffering off;
  }
}
```

Do not strip `Range`, `Content-Range`, or `Accept-Ranges`; browser video playback depends on byte-range streaming.

## Cloudflare Tunnel

Keep PhotoX bound to loopback and point the tunnel at the Web edge port:

```yaml
tunnel: <tunnel-id>
credentials-file: /path/to/<tunnel-id>.json
ingress:
  - hostname: photos.example.com
    service: http://127.0.0.1:43118
  - service: http_status:404
```

Run the tunnel with your normal cloudflared service configuration. Set `PHOTOX_WEB_PUBLIC_BASE_URL` and `PHOTOX_WEB_ALLOWED_ORIGINS` to the HTTPS hostname.

## Security behavior

- Web mode refuses to start with an access token shorter than 32 characters.
- API and WebSocket access use a token separate from device pairing.
- Administrative routes enforce `owner/admin/member/viewer` role levels server-side.
- Cross-origin requests are rejected unless explicitly allowed.
- Requests are rate-limited per source address.
- Browser media uses short-lived HMAC-signed URLs rather than putting the Web admin bearer token into image/video URLs.
- Response hardening includes CSP, frame denial, MIME sniffing prevention and no-referrer policy.
- Web mode is an edge-admin layer. Central SaaS identity/access+refresh sessions and durable audit events are still required before multi-user Internet exposure is considered production-ready.

## Operations check

After enabling Web mode, verify through the reverse proxy/domain:

1. UI bundle loads and visually matches Electron.
2. Library thumbnails/photos load.
3. Seek a video to confirm HTTP `206` Range playback.
4. Google Drive and Google Photos account lists load.
5. Migration page lists jobs and receives progress events.
6. An invalid token gets HTTP `401`.
7. An unlisted Origin gets HTTP `403`.
8. A lower role cannot invoke owner/admin operations.
