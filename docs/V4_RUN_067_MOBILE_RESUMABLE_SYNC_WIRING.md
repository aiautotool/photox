# V4 Run 067 — Mobile resumable sync wiring

## Baseline

This run continued from `54bed172546539d4ad309166999c5d9e330b4f2b`. Existing Desktop resumable ingest was already production-wired, while Mobile had a resumable SDK and Expo adapters but `mobileSync.ts` still used whole-file upload.

## Completed

- Added end-to-end `AbortSignal` support to `@photox/mobile-sdk` resumable uploads.
  - aborts create/status/chunk/finalize fetch requests;
  - aborts bounded file reads and incremental SHA-256 work;
  - preserves the durable upload session on cancellation so a later run can resume from server-owned `acknowledgedBytes`;
  - keeps the existing single retry after access-token refresh.
- Added an SDK integration regression proving an in-flight PATCH can be cancelled without consuming the durable session.
- Wired Mobile local and public Desktop transports to `createMobileResumableClient()` + `createExpoUploadSource()`.
  - progress is now based on server acknowledged bytes;
  - Mobile only calls `markAssetSynced()` after resumable finalize returns `COMMITTED` or `ALREADY_RECEIVED`;
  - unsupported media types fail before resumable transport;
  - public transport fails closed instead of silently downgrading;
  - local transport may fall back to the existing relay whole-file path during rollout;
  - relay remains whole-file compatibility transport and now cancels its native upload task when the sync signal aborts.
- CI initially found TypeScript narrowing was lost inside the async resumable closure. The runtime photo/video guard is now followed by a narrowed immutable `mediaType` value, then the full gate was rerun successfully.

## Validation

Code HEAD `3dcc7018ae2af122d01896ea4d7578fec4cfa462` passed the repository CI gate:

- npm install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop application smoke: PASS

Direct local clone/build remains NOT VERIFIED in the automation execution environment because `github.com` DNS is unavailable there; GitHub Actions is the authoritative validation path for this run.

## Priority invariants carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and a safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected only. Destinations remain append-only Google Photos upload or connected Google Drive; never claim unrestricted source-library crawling.
3. Web and Desktop continue sharing the exact React UI/components/styles through the shared `DesktopBridge`, with authenticated HTTP/WebSocket transport and the existing public-edge security requirements.

## Remaining risks / NOT VERIFIED

- Physical Android/iOS network-loss, app-kill and restart resume acceptance is NOT VERIFIED.
- Relay transport is still whole-file rather than byte-offset resumable.
- Signed IPA/APK/AAB and signed Windows/macOS installers are NOT VERIFIED.
- Live Google Drive and Google Photos account acceptance is NOT VERIFIED.
- Real public TLS/reverse-proxy/WebSocket/Range deployment acceptance is NOT VERIFIED.
- Stripe live end-to-end billing is NOT VERIFIED.
- Multi-user resumable audit attribution still needs hardening so actor user identity is authoritative rather than the legacy owner-compatibility identity.

## Next prioritized batch

Harden mobile resumable rollout with integration coverage around transport selection/fallback and cancellation semantics, then close physical-device restart/network-loss acceptance gaps. After that, make relay capable of resumable forwarding (or remove the whole-file downgrade once rollout compatibility allows it) and harden resumable audit actor attribution for multi-user workspaces.
