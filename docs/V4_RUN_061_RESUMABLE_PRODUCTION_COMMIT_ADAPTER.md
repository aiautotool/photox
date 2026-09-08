# V4 Run 061 — Resumable production commit adapter

## Scope completed

This run continued from the existing V4 resumable receiver foundation and added the production-shaped final media handoff that the receiver runtime will use when it is mounted into `startReceiver()`.

`desktop/electron/resumableMediaProductionCommit.ts` now provides a reusable commit adapter that:

- accepts only lifecycle-verified resumable upload input;
- requires the upload part to live below the managed incoming root through the existing ingest recovery journal path checks;
- copies the verified `.part` into the dated PhotoX library instead of renaming/deleting it;
- fsyncs and re-verifies the copied target size and SHA-256 before catalog ingest;
- writes the authoritative media row through an injected catalog writer;
- uses the existing ingest recovery journal around the local-file/catalog handoff;
- preserves the authoritative resumable `.part` until the lifecycle has completed downstream quota ownership and session cleanup;
- does not roll back durable media when retryable video/cloud post-processing fails;
- leaves a journal behind for startup recovery if journal cleanup itself fails after the catalog row became authoritative.

The non-destructive copy is an important ordering invariant: resumable quota commit occurs after media commit in the lifecycle. Consuming the `.part` inside the media adapter would make a downstream failure impossible to retry because the persisted session would claim acknowledged bytes whose part file no longer existed.

## Regression coverage

`desktop/electron/resumableMediaProductionCommit.test.ts` is included in the Electron test gate and covers:

- verified copy into the library while preserving the authoritative upload part;
- safe filename/date placement and authoritative media-row construction;
- catalog failure rollback without consuming resumable bytes;
- rejection of upload parts outside the managed incoming root;
- video queued state and non-destructive handling of post-commit processing failure.

## Priority requirements carried forward

1. Google Drive allocation remains quota-authoritative: there is no fixed 10 GiB PhotoX cap. The default account allocation is 2/3 of authoritative Google total quota, constrained by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains compliant with the current Google Photos Picker API for source selection. PhotoX must not advertise unrestricted full-library crawling. Selected media can be transferred append-only to another Google Photos account or to a connected Google Drive account with durable ledger/progress/pause/resume/retry/verification.
3. Web remains the same React UI/components/styles as Desktop through the shared `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters plus workspace/session auth, role enforcement and public-edge hardening.

## Still incomplete / risks

- The resumable HTTP runtime is not yet mounted into production `startReceiver()`; whole-file `POST /api/v1/media` is still the active mobile ingest path.
- There remains a cross-authority finalize edge case to close before claiming production-ready resumability: if media commit succeeds and durable quota commit fails, a retry must distinguish "this session already committed the media" from an unrelated pre-existing duplicate so that quota ownership is reconciled rather than incorrectly released. This needs a durable finalize/commit marker or equivalent repository-level ownership link.
- Mobile still does not persist a resumable session ID and resume from server-authoritative `acknowledgedBytes`.
- Live Google Drive/Google Photos account acceptance, physical power-loss acceptance, signed mobile/desktop releases, real TLS reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.

## Next prioritized batch

Close the durable finalize ownership edge case first, then mount `createResumableMediaReceiverRuntime()` plus `createWorkspaceResumableQuotaHooks()` and this production commit adapter into `startReceiver()`. The production route must use bearer `media:write` authorization, keep resumable state under the managed incoming root, start/stop expiry cleanup with app lifecycle, and preserve the existing whole-file route during client migration. After the server path is green, move mobile to durable `sessionId` + status/chunk/finalize using server-confirmed offsets.
