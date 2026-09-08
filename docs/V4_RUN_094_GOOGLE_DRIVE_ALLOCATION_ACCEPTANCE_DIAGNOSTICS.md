# V4 Run 094 — Google Drive allocation acceptance diagnostics

## Goal

Move the Google Drive quota-allocation P0 from implementation-only confidence toward production-visible acceptance evidence without mutating user data.

PhotoX must never apply a fixed 10 GB cap. The default allocation remains two thirds of the authoritative Google account total quota, while effective writable capacity is also bounded by the account's actual remaining provider bytes after the configured safety reserve. Each account may override the allocation ratio and reserve through its persisted workspace-scoped policy.

## Implemented

- Added a read-only allocation verification object to each runtime Google Drive allocation returned to Desktop/Web.
- The verification source is explicitly `google-drive-about.storageQuota`, matching the Drive v3 `about?fields=storageQuota` quota source already used by the production runtime.
- Verification independently recomputes:
  - `floor(providerTotalBytes * allocationRatio)`;
  - remaining PhotoX bytes under the configured ratio after PhotoX-owned bytes;
  - actual provider remaining bytes after safety reserve;
  - effective writable bytes as the minimum of ratio remaining and provider remaining after reserve.
- Verification fails closed as unavailable when authoritative total quota is unavailable.
- Added shared Desktop/Web UI status on each Google Drive account. The UI shows whether the current allocation has been verified against authoritative Google quota and never exposes OAuth tokens, workspace identifiers, session data, or provider credentials.
- Existing policy controls remain backed by the real workspace policy store; no mock controls were added.
- Kept the renderer diagnostics field optional at the TypeScript compatibility boundary so older fixtures/callers remain valid; production runtime projections still always emit the verification object.

## Regression coverage

- Default 2/3 allocation on a 120 GiB authoritative quota produces an 80 GiB PhotoX allocation limit, explicitly proving the implementation is not capped at 10 GiB.
- Custom per-account ratio remains authoritative.
- When provider free space is the tighter constraint, effective writable bytes are bounded by `providerFreeBytes - safetyReserveBytes` even when the ratio allowance is much larger.
- Missing/malformed authoritative quota remains fail-closed and does not invent provider capacity.

## Validation

CI run 1074 exposed a TypeScript compatibility regression in an existing `DriveAllocationPolicyService` test fixture because the new renderer verification field was initially required. The contract was corrected to make that diagnostics extension optional for callers while preserving unconditional production emission, and the regression tests were updated to assert the production projection explicitly.

Code HEAD `24967741bb36a0df2cbbb455c6931b948c7dc863` then passed CI run 1079 (`34223211813`) completely:

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

## Production acceptance status

This batch provides production-visible, live-safe diagnostic evidence but does not claim a live Google account acceptance run. A real connected Google Drive account is still required to verify provider-returned quotas and token-refresh behavior in the packaged application.

## Carry-forward P0 requirements

1. Google Drive allocation: no fixed 10 GB cap; default 2/3 authoritative total quota; respect actual remaining bytes and safety reserve; configurable per account.
2. Google Photos migration: Picker-selected source only, append-only Google Photos destination or connected Drive destination, durable ledger/progress/pause/resume/retry/verification, and no unrestricted full-library crawling claims.
3. Web edition: exact shared React UI/components/styles with Desktop through DesktopBridge; authenticated HTTP/WebSocket adapter; configurable exposure; Range streaming; workspace/session/role/CORS/CSRF/rate-limit/audit controls.

## Next prioritized batch

Build a live-safe Google Drive acceptance harness around a connected account that refreshes `about.storageQuota`, records only non-secret quota/allocation observations, validates the current policy formula without uploading or deleting media, and exposes the latest acceptance observation read-only in shared Desktop/Web operations UI. Then move to Google Photos Picker migration acceptance.
