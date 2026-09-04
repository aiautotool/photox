# PhotoX V4 — Run 43: Drive Allocation Transport Contract

## Goal
Continue from Run 42 by preparing a strict, renderer-safe mutation contract for per-account Google Drive allocation settings before wiring IPC/Web transport and UI.

## Implemented
- Added `driveAllocationTransport.ts` with a fail-closed parser for Drive allocation mutation payloads.
- Client payloads may contain only `maxUsageRatio` and/or `safetyReserveBytes`.
- Client-supplied workspace/account/provider binding fields are rejected rather than trusted.
- Ratio must remain in the inclusive 0..1 range.
- Safety reserve must be a non-negative safe integer byte count.
- Empty patches and non-finite values are rejected.
- Merge semantics preserve unspecified values and fall back to the production defaults: 2/3 ratio and 100 MiB reserve.
- Added stable HTTP status mapping for validation, authorization and account-not-found errors.
- Added regression tests and included them in the Electron test gate.

## Preserved P0 contracts
- No fixed 10 GB PhotoX cap is introduced.
- Default Drive allocation remains 2/3 of the provider-authoritative total quota and is still bounded by actual provider remaining bytes plus safety reserve in the core allocator.
- Google Photos migration remains Picker-selected only and append-only for Google Photos destinations.
- Web/Desktop continue to share the same React UI and DesktopBridge architecture.

## Remaining integration gap
The transport contract is intentionally not exposed to UI yet. `main.ts` still needs to load persisted ratio/reserve into runtime `StorageAccount`, expose a renderer-safe allocation snapshot, bind authenticated account identity server-side, add owner/admin Electron IPC and Web PATCH with CSRF/audit, and only then enable the shared Desktop/Web editor.

## Verification gate
This batch is complete only if repository tests, TypeScript typecheck, production build and final-head CI are green. Signed iOS/Android release builds and live provider E2E remain NOT VERIFIED unless explicitly run.
