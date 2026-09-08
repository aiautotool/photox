# PhotoX V4 Run 096 — Google Drive acceptance production isolation

## Scope

This run continues directly from Run 095. It does not change the authoritative Google Drive allocation formula and does not touch branch `v3`.

The current P0 storage contract remains:

- no fixed 10 GB PhotoX cap;
- default allocation ratio is `2/3` of authoritative Google account total quota;
- account-specific ratio remains configurable;
- effective writable bytes remain bounded by both ratio allowance and actual provider remaining bytes after the configured safety reserve.

## Implemented

`LiveSafeDriveAllocationAcceptance` now exposes a production-safe `observeBestEffort()` boundary.

The method preserves the same read-only provider contract as the strict acceptance harness, but isolates all verification or durable-ledger failures from callers. A healthy observation is still verified and persisted. A failed observation reports through an optional error callback and returns `undefined` instead of throwing into the account refresh / backup path.

This is intentionally required before production wiring because acceptance telemetry must never make a connected Google Drive account unavailable, block backup selection, or alter provider data.

## Regression coverage

Added tests prove that:

1. malformed authoritative quota remains fail-closed for acceptance but is isolated from production callers;
2. no accepted observation is written on isolated failure;
3. a healthy best-effort observation still persists the independently verified allocation result;
4. the existing default `2/3`, custom ratio, provider remaining bytes and safety reserve coverage remains unchanged;
5. no credential, email or workspace identifier is persisted by the acceptance ledger.

## Remaining production wiring

The next Drive batch must instantiate the durable acceptance ledger from Desktop state and invoke `observeBestEffort()` from the existing `runtimeDriveAccounts()` authoritative quota-refresh path after `about.storageQuota` and PhotoX app-used bytes are known. The resulting latest non-secret observation should then be projected read-only through the existing shared DesktopBridge/Web API account model so Desktop and Web render the same status.

That integration must preserve these invariants:

- acceptance failures never remove an otherwise usable Drive account from runtime selection;
- no extra upload/delete/folder mutation capability is introduced;
- no OAuth token, workspace/session ID, provider credential or media identity is exposed in renderer/Web payloads;
- stale or missing acceptance evidence is displayed as not verified, never as a synthetic pass.

## Carry-forward priorities

1. Finish production wiring for live-safe Google Drive allocation acceptance and shared Desktop/Web visibility.
2. Add live-safe Google Photos Picker migration acceptance around real Picker sessions and append-only destinations.
3. Continue Web/Desktop shared UI and public deployment hardening.
4. Continue mobile/desktop SaaS completion, reliability, observability, security, billing-ready and release/deployment work.

## Platform verification status

Native signed iOS/Android and signed Windows/macOS installers remain NOT VERIFIED unless a platform-specific signed build is executed in a suitable environment.
