# PhotoX V4 Web deployment

PhotoX Web is served by the Desktop edge and reuses the exact Desktop React renderer. The edge should stay disabled unless Web access is explicitly needed.

## Required environment

```bash
PHOTOX_WEB_ENABLED=true
PHOTOX_WEB_HOST=127.0.0.1
PHOTOX_WEB_PORT=43118
PHOTOX_WEB_PUBLIC_BASE_URL=https://photos.example.com
PHOTOX_WEB_ALLOWED_ORIGINS=https://photos.example.com
PHOTOX_WEB_RATE_LIMIT=300
```

For production Internet exposure, keep `PHOTOX_WEB_HOST=127.0.0.1` whenever the reverse proxy runs on the same machine. Do not expose port `43118` directly to the public Internet. `PHOTOX_WEB_PUBLIC_BASE_URL` must be the final HTTPS browser origin so login links and signed media URLs use the external domain and refresh cookies are marked `Secure`.

The proxy must preserve normal HTTP methods, `Authorization`, `Cookie`, `Origin`, `Range`, `Content-Range`, `If-Range`, `Sec-WebSocket-*` headers, and WebSocket upgrade traffic. Do not cache `/api/web/v1/*` responses. Media byte-range responses must pass through unchanged.

## Cloudflare Tunnel

Bind PhotoX only to loopback, then point a named Cloudflare Tunnel hostname to the local edge.

`~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/USER/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: photos.example.com
    service: http://127.0.0.1:43118
    originRequest:
      httpHostHeader: photos.example.com
  - service: http_status:404
```

Run:

```bash
cloudflared tunnel run YOUR_TUNNEL_NAME
```

Use:

```bash
PHOTOX_WEB_PUBLIC_BASE_URL=https://photos.example.com
PHOTOX_WEB_ALLOWED_ORIGINS=https://photos.example.com
```

Cloudflare Tunnel supports WebSocket upgrades automatically. Avoid Cloudflare cache rules for `/api/web/v1/*`; PhotoX authentication, signed media URLs and Range streaming are edge-authoritative.

## Caddy

```caddyfile
photos.example.com {
    encode zstd gzip

    reverse_proxy 127.0.0.1:43118 {
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}
    }

    @api path /api/web/v1/*
    header @api Cache-Control "no-store"
}
```

Caddy terminates TLS automatically for normal public DNS deployments and forwards WebSocket upgrades through `reverse_proxy`.

## nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name photos.example.com;

    ssl_certificate     /etc/letsencrypt/live/photos.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/photos.example.com/privkey.pem;

    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:43118;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_buffering off;
        proxy_request_buffering off;
    }

    location /api/web/v1/ {
        proxy_pass http://127.0.0.1:43118;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_buffering off;
        proxy_request_buffering off;
        add_header Cache-Control "no-store" always;
    }
}
```

PhotoX media routes support byte ranges. nginx must not rewrite a `206 Partial Content` response into a full response and must not strip `Range`/`Content-Range` headers.

## Security checklist

- Public Web access uses only HTTPS.
- Keep the PhotoX edge loopback-bound behind the proxy where possible.
- Set one exact `PHOTOX_WEB_ALLOWED_ORIGINS` entry per trusted browser origin; do not use `*` with credentialed access.
- Generate Web login links from trusted Desktop UI only. Login tickets expire quickly and are single-use.
- Refresh credentials stay in HttpOnly/SameSite cookies; browser JavaScript should only keep the short-lived access token.
- Keep CSRF protection enabled and preserve cookies plus `x-csrf-token` on authenticated mutations.
- Do not cache authentication endpoints, migration APIs, library JSON or signed media responses at a shared proxy/CDN layer.
- Restrict firewall access to the edge port when the proxy is not loopback-local.
- Rotate/revoke Web sessions from PhotoX when a browser/device is lost.
- Audit logs remain the authoritative record for successful Web administrative mutations.

## Verification after deployment

1. Open the Desktop-generated one-time Web link on the HTTPS hostname.
2. Confirm the URL fragment disappears after bootstrap.
3. Reload the page and confirm the session refreshes without another login link.
4. Open an image and a video; seek inside the video to verify Range streaming.
5. Keep the page open long enough for access-token refresh and confirm WebSocket-driven status updates reconnect.
6. Try a mutation without the CSRF header from a separate HTTP client and confirm it is rejected.
7. Revoke the Web session and confirm subsequent API/WebSocket requests are rejected.
