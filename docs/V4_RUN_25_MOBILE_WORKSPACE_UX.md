# PhotoX V4 Run 25 — Mobile workspace/quota UX

## Completed

- Added an authenticated Mobile workspace client that reuses the existing v2 paired workspace session and refresh path instead of creating a second mobile identity model.
- Mobile reads the authoritative workspace overview from the existing Web/Desktop workspace API contract and reads registered devices from the same workspace-bound API.
- Added a real Expo Router `workspace` screen showing workspace identity, current plan/role/status, authoritative quota dimensions, technical entitlements and active registered devices.
- Quota presentation uses backend-provided current/limit/remaining/percent values; it does not derive plan limits locally.
- Device read failures are isolated from workspace/quota loading so a lower-privilege user still sees the authoritative workspace snapshot.
- No Mobile admin/revoke mock controls were introduced. Destructive device/session operations remain on the established authorization + CSRF-backed Desktop/Web path until Mobile gets a dedicated safe mutation contract.

## Preserved P0 requirements

- Google Drive allocation remains based on the authoritative account quota, default PhotoX ratio 2/3, actual provider remaining bytes and safety reserve; no fixed 10 GB allocation is introduced.
- Google Photos migration remains Picker-selected source only with append-only Google Photos or connected Google Drive destinations, durable ledger/progress/pause/resume/retry/verification and no unrestricted-library claim.
- Web continues to use the exact shared Desktop React renderer and DesktopBridge with authenticated HTTP/WebSocket, Range streaming and public-edge protections.

## Validation

GitHub CI for the code batch runs `npm install`, repository tests, full TypeScript typecheck (including `@photosync/mobile`) and the production repository build. Native signed iOS/Android release artifacts are environment/signing dependent and remain NOT VERIFIED.

## Next prioritized batch

1. Make the Mobile workspace screen discoverable from the existing account/device sheet without duplicating workspace state in `MobileHome`.
2. Add a dedicated Mobile-safe device/session mutation contract if product UX requires revocation from Mobile; preserve server-side membership/owner protections and audit.
3. Implement authoritative subscription snapshot/control-plane state before any billing/change-plan controls.
4. Continue member/invite lifecycle and provider-connection tenant audit.
