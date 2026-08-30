# PhotoSync Suite

# photox

Photo/video sync and storage management for **iOS + Android + Windows + macOS**.

## Architecture

The laptop is the hub. Mobile never talks to Google Drive directly.

```text
Phone Photos / MediaStore
        ↓ HTTPS
PhotoSync Relay / Reverse Tunnel
        ↓ WSS + streamed delivery
PhotoSync Laptop Receiver
        ↓
Local Library (Pictures/PhotoSync/YYYY/MM)
        ↓
Storage Manager
   ├── Local copy
   ├── Google Drive account 1
   ├── Google Drive account 2
   └── Google Drive account N
```

## Stack: TypeScript only
- `mobile/` — React Native + Expo
- `desktop/` — React + Electron
- `relay/` — Internet reverse-tunnel relay
- `packages/core/` — shared media/quota/storage allocator logic
- `packages/google-drive/` — Google Drive API client used by desktop only

## Pair once, sync later

Desktop creates a persistent `desktopId`, `pairToken`, and `hostSecret`, then connects outbound to the relay. The desktop UI shows a QR code.

Mobile scans that QR once and stores the pairing in Expo SecureStore/Keychain. No IP address and no 6-digit code are required.

On later runs:
- desktop reconnects to the relay automatically when the laptop starts;
- mobile auto-checks/syncs on app launch and foreground resume;
- a background task also performs best-effort sync while the app is inactive;
- no QR scan is required again unless the user explicitly forgets the laptop.

## Mobile responsibilities
- Read real Photos / MediaStore assets.
- Scan pairing QR once.
- Persist the pairing token securely.
- Upload originals through the Internet relay.
- Wait until the laptop ACKs that each item has actually reached the desktop storage pipeline.
- No Google OAuth, no Google Drive quota, no storage allocation logic.

## Laptop responsibilities
- Keep an outbound WSS reverse-tunnel connection to the relay.
- Receive Internet uploads and feed them into the local receiver pipeline.
- Store originals in `Pictures/PhotoSync/YYYY/MM`.
- Index by `deviceId + assetId` and calculate SHA-256.
- Manage Google OAuth accounts and distribute media to Drive accounts.

## Drive safety rule

```text
appUsed + incomingFile <= 10 GiB
providerFreeAfterUpload >= 5 GiB
```

If no Drive has safe capacity, the file remains safe locally and cloud state becomes `BLOCKED`.

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

For Internet access, point `PHOTOSYNC_RELAY_URL` to a public HTTPS relay. A named Cloudflare Tunnel is recommended for a stable relay hostname. See `docs/RUN_REAL_SYNC.md`.

Mobile:

```bash
cd mobile
npx expo prebuild --clean
npm run android
# or on macOS
npm run ios
```

Open **Máy tính** → **Quét QR từ laptop** once.

## Background caveat
Android/iOS control when deferrable background tasks execute. Foreground resume sync is immediate; background sync is best effort. For true near-instant wake-up when a laptop comes online while the phone app is suspended, use a headless/silent push trigger from the relay (APNs/FCM/Expo Push) in the production deployment.

## Test

```bash
npm test
npm run typecheck
npm run build
```
