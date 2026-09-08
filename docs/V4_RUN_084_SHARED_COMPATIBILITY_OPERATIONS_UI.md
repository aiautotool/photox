# V4 Run 084 — Shared compatibility operations UI

## Goal

Surface the production legacy whole-file compatibility telemetry added in Runs 080–083 through the existing shared Desktop/Web React operations UI, without creating mock controls or adding a second diagnostics authority.

## Analysis

The existing `mediaCatalogDiagnosticsForDesktopOperator()` and `mediaCatalogDiagnosticsForWeb()` transports already attach `legacyWholeFileCompatibility` from the production telemetry runtime. The Web operations endpoint is already protected by authenticated workspace access plus owner/admin role enforcement, and the shared React renderer already polls that endpoint through the `DesktopBridge` contract.

Therefore this batch intentionally does **not** add a new HTTP endpoint, IPC channel, role, or mutable control. The existing operations boundary remains the source of truth and the same React component renders on Desktop and Web.

## Implemented

- Added `legacyWholeFileOperationsUi.ts` as a renderer-safe view model for aggregate compatibility diagnostics.
- Added readable mappings for deprecation blockers while retaining the authoritative blocker codes in the view model.
- Added fail-closed rendering for an uninitialized telemetry runtime and unhealthy persistence.
- Extended the existing `MediaCatalogOperationsPanel` with a read-only **Legacy whole-file compatibility** section.
- The panel now shows:
  - total compatibility requests;
  - bearer / pair-code / pairing-challenge counts;
  - accepted / duplicate / rejected outcomes;
  - durable persistence health;
  - observation-window progress;
  - observed-since, last-request, and last-durable-write timestamps when available;
  - physical-device resumable acceptance state;
  - authoritative deprecation blockers.
- No UI action can mark physical-device acceptance as passed or retire the compatibility route.
- Existing Web admin/owner visibility rules remain unchanged; member/viewer sessions do not gain access to operations diagnostics.

## Regression coverage

`legacyWholeFileOperationsUi.test.ts` covers:

1. aggregate auth/outcome counts and readable blocker mapping;
2. fail-closed uninitialized runtime behavior;
3. unhealthy persistence never becoming retirement-ready;
4. ready state only when authoritative runtime readiness is true.

Repository CI remains the executable gate for repository tests, TypeScript typecheck, production renderer build, Desktop renderer smoke, Electron directory packaging, and packaged Desktop smoke.

## Priority requirements carried forward

1. Google Drive allocation remains quota-derived, never a fixed 10 GiB cap: default PhotoX allocation is `2/3` of authoritative Google total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, with append-only destination upload to a connected Google Photos account or transfer to a connected Google Drive account; no unrestricted full-library crawling is advertised.
3. Web continues to use the exact shared Desktop React components/styles through the `DesktopBridge` model, with authenticated HTTP/WebSocket adapters and the existing Web security boundary.

## Remaining risks / NOT VERIFIED

- Physical Android/iOS network-loss → process-kill → restart → byte-offset resumable recovery.
- Signed IPA/APK/AAB and signed Windows/macOS installer acceptance.
- Live multi-account Google Drive / Google Photos migration acceptance.
- Physical power-loss recovery.
- Real public TLS + reverse-proxy + WebSocket + media Range deployment acceptance.
- Stripe live end-to-end billing acceptance.

## Next prioritized batch

Build a **physical-device resumable acceptance evidence workflow** rather than a normal UI toggle. The evidence should be durable, attributable to a concrete release/build and device/platform test scenario, and only then be consumable by deprecation readiness. It must prove network interruption plus process kill/restart resumes from the authoritative server byte offset and completes/verifies the same media asset without duplicate quota/catalog side effects.
