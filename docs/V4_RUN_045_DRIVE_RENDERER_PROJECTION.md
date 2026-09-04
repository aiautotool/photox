# PhotoX V4 — Run 45: Drive Renderer Projection

## Goal
Continue the Google Drive allocation work without enabling any UI control before the backing runtime and transport are complete.

## Implemented
- Added a renderer-safe account-level Google Drive projection on top of the existing runtime allocation adapter.
- Ready accounts expose authoritative provider total/used/free bytes together with the effective PhotoX allocation ratio, ratio-derived allocation limit, safety reserve, PhotoX app-used bytes, remaining bytes and final writable bytes.
- Unavailable accounts retain their persisted ratio and reserve so the UI can explain policy state without inventing provider quota data.
- OAuth tokens, workspace binding and credential material are deliberately absent from the renderer projection.
- Added regression coverage for ready and unavailable projections, secret exclusion and preservation of the existing 2/3 + reserve allocation semantics.

## Preserved P0 contracts
- No fixed 10 GB cap. Default PhotoX Drive allocation remains 2/3 of authoritative provider total quota, bounded by provider remaining bytes and safety reserve, with per-account policy support.
- Google Photos migration remains Picker-selected only and append-only for Google Photos destinations.
- Desktop and Web remain on the shared React/DesktopBridge architecture.

## Remaining integration gap
`desktop/electron/main.ts` still constructs runtime Drive storage objects directly. The next batch should replace that construction with `driveRuntimeAllocation()` and return `rendererDriveAccountInfo()` from account listing, then add authenticated owner/admin IPC/Web policy mutation transport before enabling the shared allocation editor.

## Verification gate
This batch is complete only after the final v4 HEAD passes repository tests, TypeScript typecheck and production build in CI. Signed mobile release builds and live provider E2E remain NOT VERIFIED unless explicitly run.
