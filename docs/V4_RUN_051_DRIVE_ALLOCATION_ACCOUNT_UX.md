# PhotoX V4 — Run 51: Drive Allocation Account UX

## Goal
Remove the temporary global Drive-allocation launcher and place the already-backed allocation editor inside the existing storage-account surface shared by Desktop and Web.

## Implementation
- `DriveAllocationManager` no longer renders a floating global launcher or modal sheet.
- The component locates the active `.accounts-panel` storage-account surface and portals the backed allocation controls into that panel, keeping a single Desktop/Web React runtime without duplicating account mutation logic.
- Opening the storage-account page triggers an authoritative account/quota refresh.
- Per-account ratio and safety reserve continue to save through `DesktopBridge.updateGoogleDriveAllocation()` and use the returned authoritative account snapshot after mutation.
- The editor continues to expose Google authoritative total/free quota, PhotoX app-used bytes and effective writable bytes.
- Production defaults remain 2/3 allocation and 100 MiB safety reserve; there is no fixed 10 GB cap.
- Existing loading, empty, mutation-busy, error, success and unavailable-quota states remain visible inline.

## P0 contracts preserved
- Google Drive allocation is based on authoritative provider quota, actual remaining bytes and safety reserve.
- Google Photos migration remains Picker-selected only; no unrestricted full-library crawling is claimed.
- Desktop and Web continue to share the same React component/styles and `DesktopBridge` contract.

## Verification gate
This batch is complete only after repository tests, TypeScript typecheck and production build succeed on the final `v4` HEAD through repository CI. Live Google provider E2E and signed mobile builds remain separately NOT VERIFIED unless actually executed.

## Next priority
1. Exercise Google Drive policy mutation against a real provider account when credentials/environment are available.
2. If live provider verification remains unavailable, harden Web reverse-proxy/public-host acceptance and security regressions next.
3. Continue Google Photos live migration acceptance once real OAuth accounts are available.
