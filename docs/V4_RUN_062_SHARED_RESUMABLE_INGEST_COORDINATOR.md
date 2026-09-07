# V4 Run 062 — Shared resumable ingest coordinator

## Scope

Continue the production resumable-ingest rollout without changing branch `v3`.

Before mounting the authenticated resumable HTTP routes into the production Desktop receiver, this batch re-checked the coexistence period with the legacy whole-file `POST /api/v1/media` path. Both protocols can address the same logical media identity (`workspaceId + deviceId:assetId`). They therefore must serialize final catalog commit through the same process-wide ingest coordinator.

## Analysis

The legacy whole-file receiver already uses the process-wide `mediaIngestCommitCoordinator` owned by `main.ts`.

The resumable lifecycle previously created a private coordinator internally. That protected concurrent resumable finalizations from each other, but it did not protect a resumable finalize racing a legacy whole-file upload for the same media key. During the mobile migration period, that creates an avoidable cross-protocol duplicate-commit race.

Mounting the resumable production route before closing that race would not meet the requirement to preserve working behavior safely.

## Implementation

- `resumableMediaIngestLifecycle.ts`
  - accepts an optional injected ingest coordinator;
  - defaults to its private coordinator for existing isolated/test callers;
  - uses the injected coordinator for finalize serialization when supplied.
- `resumableMediaReceiverRuntime.ts`
  - accepts and forwards the optional shared coordinator;
  - keeps all current durable session/finalize/quota behavior unchanged.
- `resumableSharedCoordinator.test.ts`
  - creates two independent resumable lifecycles with separate durable stores;
  - injects one shared coordinator;
  - starts two finalizations for the same workspace/media key concurrently;
  - verifies only the first commit callback runs and the second caller resolves as `ALREADY_RECEIVED` after the first commit becomes authoritative.
- `desktop/tsconfig.electron-test.json`
  - includes the new regression in the repository Electron test gate.

## Validation

Code HEAD `d776dc91a3d655729eb8cc9641bd0233b7d0fb8d` passed GitHub Actions CI run 917 (`34088268825`):

- repository tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux package: PASS
- packaged Desktop application smoke: PASS

Local `git clone` remains NOT VERIFIED in the automation container because DNS resolution for `github.com` is unavailable there; GitHub connector writes and GitHub Actions are the authoritative repository/CI path for this run.

## Priority requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB PhotoX cap. Default PhotoX allocation remains 2/3 of authoritative provider total quota, constrained by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API for source selection and append-only upload for Google Photos destinations; no unrestricted full-library crawling claims.
3. Web edition continues to share Desktop React components/styles through the `DesktopBridge` contract, with authenticated HTTP/WebSocket adapters, configurable exposure, Range streaming and public-access security controls.

## Remaining risk / next batch

Production `startReceiver()` still serves the legacy whole-file route and has not yet mounted `createResumableMediaReceiverRuntime()`. Mobile therefore is still NOT COMPLETE as server-authoritative byte-offset resumable upload.

Next batch priority:

1. instantiate the resumable runtime from production Desktop state;
2. inject the process-wide `mediaIngestCommitCoordinator` added to the runtime contract in this batch;
3. authorize resumable routes with `media:write` bearer sessions and authenticated workspace/device identity;
4. use `createWorkspaceResumableQuotaHooks(requireWorkspaceRepository())`;
5. use the production verified-copy/catalog commit adapter and current ingest recovery journal;
6. start/stop expiry cleanup with Desktop lifecycle;
7. preserve legacy whole-file `POST /api/v1/media` during mobile migration;
8. add receiver-composition integration coverage before switching mobile to durable `sessionId` + server `acknowledgedBytes` resume.

Platform-specific signed iOS IPA, Android APK/AAB, signed Windows/macOS installers, physical power-loss acceptance, live Google Drive/Google Photos account acceptance, public TLS/reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.
