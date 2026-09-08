# PhotoX V4 Run 088 — Durable Resumable Server Authority

## Scope completed

This run continues directly from Run 087. It does not change `v3`.

The physical-device acceptance path now has an independent durable Desktop-side authority implementation instead of relying on values reported by the mobile acceptance artifact.

### Added

- `PhysicalResumableServerAuthorityLedger`
  - durable, atomic JSON ledger owned by Desktop;
  - binds observations to authenticated workspace, device, asset and upload session;
  - records server-observed resumable offsets;
  - records authoritative quota/catalog snapshots supplied by the production composition;
  - records final received bytes and final verification state;
  - corrupt persisted state fails closed;
  - duplicate finalization (`ALREADY_RECEIVED`) is never treated as verified proof of a newly committed asset.
- Receiver runtime authority hooks
  - records newly-created resumable sessions;
  - records authoritative GET/status offsets;
  - records finalization outcome after the normal ingest transaction;
  - authority persistence failures are isolated from normal media ingest so acceptance tooling cannot break a valid upload.
- Production runtime composition
  - when authoritative physical-acceptance configuration is supplied, creates the server authority ledger;
  - creates the existing append-only physical acceptance evidence store/capture workflow;
  - creates `PhysicalResumableAcceptanceIngestion` and exposes it through the authenticated resumable acceptance route;
  - mobile remains unable to submit authoritative offset/quota/catalog/verification fields.

## Safety / correctness invariants

- Workspace/device identity comes from authenticated resumable principal binding.
- Session/asset identity must match the durable server authority record.
- Corrupt or missing required authority evidence cannot grant acceptance.
- Normal upload success does not depend on acceptance-ledger persistence.
- Evidence remains append-only through the existing physical acceptance evidence store.
- There is still no mutable `physicalDeviceResumableAccepted` toggle.

## Validation

Code HEAD `947a893675fdc29fe4289bc06c01fae6a2bea9d5` passed GitHub Actions CI run 1051 (`34192639860`):

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

Local clone/build remains NOT VERIFIED in the execution environment because `github.com` DNS resolution is unavailable there. GitHub Actions is the executable validation path for this batch.

## P0 requirements carried forward

1. Google Drive allocation stays provider-authoritative: no fixed 10 GB cap; default PhotoX allocation remains 2/3 of authoritative total Google storage, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only, with append-only destination behavior for Google Photos or connected Google Drive; do not advertise unrestricted full-library crawling.
3. Desktop/Web continue sharing the same React UI/components/styles via the shared `DesktopBridge` contract and authenticated Electron/HTTP/WebSocket adapters.

## Remaining gap / next batch

The authority and ingestion composition are production-shaped but the current Desktop `main.ts` caller does not yet provide the `physicalAcceptance` authoritative counter configuration, so the acceptance route remains fail-closed/unavailable in the normal runtime.

Next priority:

1. Wire controlled physical-acceptance mode in Desktop startup only when explicitly enabled for acceptance testing.
2. Provide authoritative workspace managed-storage bytes from the workspace repository and authoritative catalog observations from the active media catalog.
3. Keep normal production mode free of acceptance instrumentation I/O unless explicitly enabled.
4. Add end-to-end receiver regression: create -> partial upload -> status after simulated restart -> resume -> finalize -> acceptance submission. Prove that mismatched workspace/device/session/asset, missing server status, duplicate finalize, corrupt authority ledger, or mobile-supplied spoofed server fields cannot create accepted evidence.
5. Re-run repository tests, typecheck, production build, Desktop package/smoke and repository CI before marking the next batch complete.

## Still NOT VERIFIED on real platforms

- physical iOS interruption -> process kill -> restart -> authoritative offset -> byte-exact resume;
- physical Android interruption -> process kill -> restart -> authoritative offset -> byte-exact resume;
- signed IPA/APK/AAB;
- signed Windows/macOS installers;
- live multi-account Google Drive / Google Photos migration acceptance;
- physical power-loss recovery;
- public TLS/reverse-proxy/WebSocket/Range deployment acceptance;
- Stripe live E2E.
