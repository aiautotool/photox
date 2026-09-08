# PhotoX V4 Run 078 — Whole-file pre-ingest side-effect gate

## Scope

Continue Run 077 without restarting completed work. This batch hardens the remaining legacy whole-file compatibility receiver boundary before production wiring into `main.ts`.

## Implemented

- Added `desktop/electron/legacyWholeFileReceiveGate.ts`.
- The gate resolves the existing authoritative whole-file preflight contract first, then performs the authoritative duplicate lookup using the immutable `workspaceId + deviceId:assetId` key.
- Binding/identity failures therefore happen before duplicate lookup, quota reservation, request-body consumption, file creation, or audit writes.
- Duplicate results are returned before quota reservation, request-body consumption, file creation, or audit writes.
- Added an HTTP integration harness covering:
  - bearer workspace binding mismatch with zero ingest side effects;
  - missing asset identity with zero ingest side effects;
  - duplicate detection returning `ALREADY_RECEIVED` with zero body/quota/file/audit side effects;
  - authenticated member attribution for a ready bearer ingest;
  - explicit legacy compatibility attribution for pairing-challenge uploads.

## Validation

GitHub Actions CI run 995 on code HEAD `9253a6a443441447f877d59e2780bcab20fea74d` passed:

- dependency install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux package: PASS
- packaged Desktop application smoke: PASS

Local clone/test/build remains NOT VERIFIED because the execution container cannot resolve `github.com`; GitHub Actions remains the executable validation path for this run.

## Priority requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of authoritative account total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Picker API for source selection and append-only destination uploads. PhotoX must not advertise unrestricted full-library crawling.
3. Web and Desktop remain one shared React UI/component/style surface behind the shared `DesktopBridge`, with authenticated HTTP/WebSocket adapters and production public-access controls.

## Remaining gap

Production `main.ts::receiveMedia()` still performs equivalent identity and duplicate handling inline. The new gate is executable and fully regression-covered, but it is not yet the production single source of truth. The next batch should wire `receiveMedia()` to `resolveLegacyWholeFileReceiveGate()`, remove the duplicated inline workspace/device/asset/audit/duplicate logic, and preserve the current 208 duplicate response semantics.

Physical Android/iOS network-loss → process-kill → restart resumable acceptance, signed mobile artifacts, signed Windows/macOS installers, live Google Drive/Google Photos acceptance, physical power-loss testing, real TLS/reverse-proxy/WebSocket/Range deployment, and Stripe live E2E remain NOT VERIFIED.
