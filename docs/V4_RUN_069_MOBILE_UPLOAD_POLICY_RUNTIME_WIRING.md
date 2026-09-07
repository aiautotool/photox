# V4 Run 069 — Mobile upload policy runtime wiring

## Baseline

This run continued from `f570f95be3bfc2eaf292141c74fb261be2a4d840`. Run 068 had introduced a shared Mobile upload transport policy, but production `mobileSync.ts` still duplicated the public/local/relay branching inline. That left a drift risk between tested policy and runtime behavior.

## Completed

- Added `executeMobileUploadPlan()` to `@photox/mobile-sdk` so fallback execution is governed by the same policy boundary as planning.
- Added integration regressions proving:
  - public resumable failures stay fail-closed and never start relay fallback;
  - LAN resumable failures fall back exactly once to relay whole-file while rollout compatibility remains enabled;
  - cancellation is terminal and never starts fallback, preserving the resumable session for the next resume.
- Refactored production `mobile/src/sync/mobileSync.ts` to consume `planMobileUpload()` and `executeMobileUploadPlan()` directly.
- Removed duplicated `connection.transport` upload branching from the per-asset sync path.
- Preserved existing status semantics:
  - `ALREADY_RECEIVED` increments skipped;
  - `COMMITTED` increments completed;
  - relay HTTP 208 maps to already received;
  - relay 2xx maps to committed;
  - relay 503 remains an offline failure;
  - assets are marked synced only after the selected plan returns a committed/already-received outcome.

## Validation

Code HEAD `19157e6a2ca2176c41ff04028e3c49d14dee9c2a` passed GitHub Actions CI run 952 (`34124960395`):

- npm install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop application smoke: PASS

Direct local clone/test/build remains NOT VERIFIED in this execution environment because `github.com` DNS does not resolve; GitHub Actions is the authoritative validation path for this run.

## Priority invariants carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and a safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected only. Destinations remain append-only Google Photos upload or connected Google Drive; never claim unrestricted source-library crawling.
3. Web and Desktop continue sharing the exact React UI/components/styles through the shared `DesktopBridge`, with authenticated HTTP/WebSocket transport and the existing public-edge security requirements.

## Remaining risks / NOT VERIFIED

- Relay transport is still whole-file rather than byte-offset resumable.
- Physical Android/iOS network-loss, app-kill and restart resume acceptance is NOT VERIFIED.
- Multi-user resumable audit attribution still needs authoritative actor identity instead of the legacy owner-compatibility identity.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.

## Next prioritized batch

Implement relay-side resumable byte-offset forwarding so remote sync no longer requires a whole-file compatibility downgrade. Keep the same durable session/offset/finalize contract end-to-end, add relay/Desktop integration coverage for restart and offset reconciliation, then harden authoritative multi-user actor attribution for resumable audit events.
