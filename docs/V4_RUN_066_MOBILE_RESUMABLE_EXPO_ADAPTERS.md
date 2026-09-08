# V4 Run 066 — Mobile resumable Expo adapters

## Completed in this run

- Hardened `@photox/mobile-sdk` resumable HTTP requests so a `401` can trigger one authoritative auth refresh and retry the exact failed request once with newly generated headers.
- Added the production Expo adapter layer in `mobile/src/sync/resumableUpload.ts`.
- Persist resumable session ownership in `expo-secure-store`, namespaced by workspace + desktop + mobile device + asset so sessions cannot bleed across pairings or tenants.
- Read upload data by bounded file ranges through `expo-file-system` `FileHandle` instead of loading a full photo/video into JavaScript memory.
- Compute SHA-256 incrementally in bounded chunks for finalize verification.
- Connected the mobile app workspace to `@photox/mobile-sdk`.
- Added integration regression coverage proving a failed resumable request is retried after exactly one auth refresh and then completes normally.

## Validation

GitHub Actions CI run 938 (`34108600252`) on code HEAD `339bae8e520c86dfcd614b7ea282b2199fef466c` completed successfully:

- npm install: PASS
- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder package: PASS
- packaged Desktop app smoke: PASS

Local clone/test/build remains NOT VERIFIED in the current execution environment because `github.com` cannot be resolved there; GitHub Actions is the authoritative validation path for this batch.

## Still incomplete

`mobile/src/sync/mobileSync.ts` still uses the compatibility whole-file `FileSystem.createUploadTask` path. The Expo resumable adapter is now ready for production wiring, but mobile byte-offset resumable sync is not yet complete end-to-end.

Before wiring it, the SDK should accept an abort signal so user/background cancellation can stop an in-flight resumable request cleanly. Then local/public upload branches should use the resumable client, report server-authoritative acknowledged byte progress, and only mark the asset synced after finalize returns `COMMITTED` or `ALREADY_RECEIVED`. Relay whole-file upload should remain a compatibility fallback until the relay protocol is upgraded.

The mobile workspace dependency on `@photox/mobile-sdk` resolves under CI `npm install`; the repository lockfile was not regenerated in the current local environment because network resolution is unavailable, so lockfile synchronization remains a cleanup item.

## Standing P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each Google account's authoritative total storage quota, bounded by actual remaining provider bytes and safety reserve, with configurable per-account allocation ratio.
2. Google Photos migration remains Picker-selected only under the current Google Photos Picker API. Destination Google Photos writes remain append-only, with Drive as another supported destination. Never advertise unrestricted full-library crawling.
3. Web and Desktop remain one React UI/component/style system through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, configurable exposure, Range media delivery, workspace/session auth, role enforcement, CORS/CSRF/rate-limit/audit protections as applicable.

## Next prioritized batch

1. Add `AbortSignal` support to `ResumableUploadClient` requests and recovery loop.
2. Replace Mobile local/public whole-file upload with `createMobileResumableClient()` + `createExpoUploadSource()`.
3. Drive progress from server `acknowledgedBytes` and persist the session across app/network restarts.
4. Mark sync success only after `COMMITTED` / `ALREADY_RECEIVED` finalize outcomes.
5. Preserve relay whole-file compatibility fallback during rollout.
6. Add regression coverage for cancellation, local-to-relay fallback boundaries, restart recovery, stale offset, expired sessions and token refresh.
