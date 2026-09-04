# V4 Run 30 — Subscription control-plane hardening

## Scope completed

This batch continues the existing read-only subscription work without adding mock billing controls.

- Added a durable provider-event ledger keyed by `(provider, provider_event_id)`.
- Provider events can now carry `providerEventId`; duplicate delivery is rejected as `DUPLICATE_PROVIDER_EVENT` before any subscription or entitlement mutation.
- Stale provider events remain rejected by monotonic `sourceUpdatedAt`, and stale events with an event id are recorded durably so repeated replay becomes a duplicate instead of being reprocessed indefinitely.
- Event processing is performed under `BEGIN IMMEDIATE`, keeping replay detection and subscription mutation serialized in the local authoritative store.
- Added an explicit end-of-period entitlement transition. It is bound to the expected provider + subscription id, requires a canceled subscription with `cancelAtPeriodEnd`, refuses to run before `currentPeriodEnd`, is idempotent when the workspace is already on the target plan, and writes an audit event when applied.
- No media is deleted by downgrade transitions.
- No upgrade/change-plan/payment/cancel/resume UI was introduced.

## Regression coverage

`desktop/electron/workspaceSubscription.test.ts` now covers:

- durable duplicate event rejection;
- stale event recording and replay rejection;
- no mutation from duplicate/stale provider events;
- provider/subscription binding for period-end transitions;
- early transition rejection;
- successful post-period entitlement transition;
- idempotent repeat transition;
- audit creation for the applied entitlement transition.

## Validation

CI run 524 on code HEAD `b8391837b6c8f569301f88fd2e3ee8f1c60226d7` passed:

- `npm install`
- `npm test`
- `npm run typecheck`
- `npm run build`

## P0 requirements carried forward

1. Google Drive allocation remains based on the authoritative Google account total quota, default PhotoX ratio `2/3`, bounded by actual provider remaining bytes and the configured safety reserve; there is no fixed 10 GB allocation cap.
2. Google Photos migration remains compliant with the current Picker API: only user-selected Picker media is a source, and destinations remain append-only Google Photos or a connected Google Drive account. Do not advertise unrestricted full-library crawling.
3. Web continues to reuse the Desktop React UI through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters, media Range support, and workspace/session security boundaries.

## Next prioritized batch

1. Add a provider-specific signed billing webhook ingress with raw-body signature verification and strict event parsing before calling `WorkspaceSubscriptionService.applyProviderState`.
2. Add a scheduler/control-plane worker that invokes `applyEndOfPeriodEntitlementTransition` for due cancellations using explicit target-plan policy.
3. Only after those paths are authoritative, add billing mutation abstractions and then UI controls.
4. Continue Mobile workspace navigation, member/invite lifecycle, and provider/index tenant-identifier audit.

## Not verified

- Live Google Photos OAuth/migration against real accounts.
- Signed iOS IPA/Xcode release build.
- Signed Android APK/AAB release build.
