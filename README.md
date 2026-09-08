# PhotoX

Photo/video SaaS + edge sync and storage management for **iOS + Android + Windows + macOS + Web**.

## Architecture

The Desktop/edge node remains the primary local media-processing and provider-storage hub. Mobile uploads through LAN/Internet relay paths; Web reuses the exact Desktop React renderer through a shared `DesktopBridge` contract.

```text
Phone Photos / MediaStore
        ↓ HTTPS / authenticated session
PhotoX Relay / Reverse Tunnel / LAN
        ↓ WSS + streamed delivery
PhotoX Desktop Edge
        ├── SQLite media catalog authority
        ├── Local Library
        ├── FFmpeg/thumbnail/playback pipeline
        └── Storage / Replica Manager
              ├── Local
              ├── Google Drive account 1..N
              └── Telegram / other providers

Desktop React renderer
        ├── Electron IPC DesktopBridge
        └── Authenticated HTTP/WebSocket DesktopBridge for Web
```

## Stack
- `mobile/` — React Native + Expo
- `desktop/` — React + Electron; the same renderer is used for Desktop and Web
- `relay/` — Internet reverse-tunnel relay
- `packages/core/` — shared media/quota/SaaS/storage allocation logic
- `packages/google-drive/` / provider packages — provider adapters used by Desktop/edge runtime
- SQLite-backed persistence — workspace/session/jobs/media-catalog and other durable state

## Pair once, sync later

Desktop creates a persistent device identity and pairing/session context, then connects outbound to the relay. The Desktop UI shows a QR code.

Modern pairing v2 carries workspace/device context and exchanges a short-lived challenge for scoped access/refresh credentials. Mobile persists approved session material in secure storage. Legacy v1 pair-code/pair-token compatibility remains only for older clients during migration.

On later runs:
- Desktop reconnects automatically when the computer starts;
- Mobile refreshes its authenticated session and syncs on app launch/foreground resume;
- background tasks perform best-effort sync when the OS schedules them;
- no QR scan is required again unless the user forgets/revokes the device/session.

## Mobile responsibilities
- Read real Photos / MediaStore assets.
- Pair with a Desktop/workspace and persist session state securely.
- Upload originals through authenticated LAN/Internet transports.
- Wait until Desktop ACKs that each item reached the durable ingest/storage pipeline.
- Present the mobile library/viewer/editor/albums/search/sync UX using authoritative APIs.
- Mobile does not own Google Drive quota allocation logic.

## Desktop / Web responsibilities
- Keep outbound reverse-tunnel connectivity when configured.
- Receive uploads and feed them into the local ingest pipeline.
- Store originals locally according to configured library paths/policies.
- Maintain the runtime media catalog in transactional SQLite.
- Manage provider accounts, replicas, verification/repair and background jobs.
- Manage Google OAuth accounts and distribute media according to real provider quota/policy.
- Serve the same React UI to Desktop and Web through the shared `DesktopBridge`; Web access adds authenticated HTTP/WebSocket, role, CORS/CSRF/rate-limit/audit and reverse-proxy boundaries as applicable.

## Google Drive allocation rule

There is **no fixed 10 GiB PhotoX cap**.

```text
allocationRatio = configuredRatio ?? 2/3
allocationLimit = floor(authoritativeProviderTotalBytes * allocationRatio)
ratioRemaining = max(0, allocationLimit - photoXAppUsedBytes)
providerRemainingAfterReserve = max(0, authoritativeProviderFreeBytes - safetyReserveBytes)
safeAvailable = min(ratioRemaining, providerRemainingAfterReserve)
```

The ratio and safety reserve are configurable per account. Actual provider remaining bytes are always respected. If no Drive account has safe capacity for a whole file, the durable cloud/replication job remains blocked/retryable while the already-ingested local original stays available.

## Google Photos migration

Google Photos source access is **Picker-selected only** through the current Google Photos Picker API. PhotoX does not claim unrestricted full-library crawling. Selected media is staged durably and transferred with a migration ledger, progress, pause/resume/retry and verification to either:
- another Google Photos account using append-only destination upload; or
- a connected Google Drive account.

## Media catalog authority

Desktop runtime uses SQLite as the sole active media catalog. `media-index.json` is legacy-only: it may be consumed once as a cutover import source, and JSON exports may be produced for offline recovery, but JSON is not a live runtime writer.

## Run locally
Requires Node.js 22+.

```bash
npm install
npm run relay
```

In another terminal:

```bash
cp desktop/.env.example desktop/.env
npm run desktop
```

For Internet access, point the relay/public Web settings at approved HTTPS endpoints. See `docs/RUN_REAL_SYNC.md` and `docs/WEB_DEPLOYMENT.md`.

Mobile:

```bash
cd mobile
npx expo prebuild --clean
npm run android
# or on macOS
npm run ios
```

## Background caveat
Android/iOS control when deferrable background tasks execute. Foreground resume sync is immediate; background sync is best effort. Near-instant wake-up while the app is suspended requires an approved push-trigger design (APNs/FCM/Expo Push) plus the normal authenticated sync path.

## Test

```bash
npm test
npm run typecheck
npm run build
```

Completed V4 batches must also pass repository CI. Platform-specific signed installers/device builds that cannot run in the current environment are reported as **NOT VERIFIED**, never as PASS.
