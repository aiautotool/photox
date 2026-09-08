# V4 Run 068 — Mobile upload transport policy hardening

## Baseline

This run continued from `22dab74a2965889896797504320aaf2c50d192a6`. Desktop resumable ingest and Mobile LAN/Public resumable upload were already production-wired. The remaining rollout risk was that transport selection and fallback/cancellation semantics still lived inline in `mobileSync.ts`, making the public fail-closed and LAN compatibility-fallback rules difficult to regression-test independently.

## Completed

- Added shared `UploadTransportPolicy` to `@photox/mobile-sdk`.
  - public transport selects authenticated resumable upload only and has no legacy relay fallback;
  - local/LAN selects resumable upload first and may use relay whole-file only as the temporary rollout fallback;
  - relay transport remains legacy whole-file until relay byte-offset forwarding is implemented;
  - cancellation is terminal and explicitly forbids starting a fallback upload, preserving the durable resumable session for a later resume.
- Exported the policy from the Mobile SDK public surface.
- Added SDK integration regression coverage for all three transport plans and the critical cancellation/no-fallback invariant.

The policy intentionally mirrors the production behavior currently in `mobileSync.ts`; wiring `mobileSync.ts` to consume this shared policy is the next small refactor so runtime selection and tested policy have one source of truth.

## Validation

Code HEAD `0e1594e261131fc1bb70b93c386b40a3b66e198c` passed GitHub Actions CI run 948 (`34118645766`):

- npm install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop application smoke: PASS

Direct local clone/test/build remains NOT VERIFIED in the automation execution environment because `github.com` DNS does not resolve there; GitHub Actions remains the authoritative validation path for this run.

## Priority invariants carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and a safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected only. Destinations remain append-only Google Photos upload or connected Google Drive; never claim unrestricted source-library crawling.
3. Web and Desktop continue sharing the exact React UI/components/styles through the shared `DesktopBridge`, with authenticated HTTP/WebSocket transport and the existing public-edge security requirements.

## Remaining risks / NOT VERIFIED

- `mobileSync.ts` still needs to consume the shared transport policy directly so tested policy and runtime branching cannot drift.
- Physical Android/iOS network-loss, app-kill and restart resume acceptance is NOT VERIFIED.
- Relay transport is still whole-file rather than byte-offset resumable.
- Multi-user resumable audit attribution still needs authoritative actor identity instead of the legacy owner-compatibility identity.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.

## Next prioritized batch

Wire `mobileSync.ts` to use `planMobileUpload()` / `shouldFallbackMobileUpload()` as the single transport decision source, then add runtime-level coverage around LAN fallback, public fail-closed behavior and cancellation. After that, implement resumable relay forwarding and harden authoritative multi-user audit actor attribution.
