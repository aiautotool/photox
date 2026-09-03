# PhotoX V4 Run 26 — Authoritative subscription control-plane state

## Completed

- Added `WorkspaceSubscriptionService` as the first billing-ready control-plane boundary. It persists one authoritative subscription state per workspace in `photox_workspace_subscriptions` and keeps provider/customer/subscription identifiers out of renderer-facing snapshots.
- Subscription reads require an active workspace membership, a current role claim and owner/admin role. Cross-workspace callers and stale-role actors fail closed.
- Provider state ingestion is monotonic by `sourceUpdatedAt`; stale/replayed provider events are ignored rather than overwriting newer subscription state.
- Active/trialing/past-due provider state can promote the workspace technical plan used by the existing entitlement/quota engine. Paused/canceled states are persisted but deliberately do not auto-downgrade entitlements; end-of-period downgrade policy remains a separate control-plane transition so media is never deleted or unexpectedly blocked by a webhook ordering edge case.
- Every applied provider transition emits workspace-scoped `subscription.state.updated` audit metadata without storing provider customer identifiers in the audit payload.
- Before a billing provider is connected, owner/admin reads receive a truthful `legacy/unmanaged` snapshot derived from the current workspace plan rather than a fake subscription.

## Regression coverage

- legacy/unmanaged fallback;
- workspace-scoped active subscription state;
- effective workspace plan promotion;
- stale provider-event rejection;
- no provider customer ID leakage through snapshot/audit;
- owner/admin authorization, stale-role rejection and cross-tenant rejection;
- canceled state persistence without automatic entitlement downgrade.

## Preserved priority requirements

- Google Drive allocation remains authoritative-quota based with default PhotoX ratio `2/3`, actual provider remaining bytes, safety reserve and configurable per-account ratio; no fixed 10 GB cap is introduced.
- Google Photos migration remains Picker-selected source only, with append-only Google Photos or connected Google Drive destinations plus durable ledger/progress/pause/resume/retry/verification. No unrestricted full-library claim is introduced.
- Web continues to reuse the Desktop React renderer/DesktopBridge and existing authenticated HTTP/WebSocket, Range streaming and public-edge protections.

## Next prioritized batch

1. Wire the subscription snapshot through `DesktopWorkspaceAuth`, Electron IPC, authenticated Web HTTP and the shared `DesktopBridge`; expose read-only subscription status in shared Desktop/Web workspace UX only after the transport is authoritative.
2. Make the existing Mobile `/workspace` screen discoverable from the account/device sheet without duplicating workspace state.
3. Define a separate end-of-period downgrade transition/scheduler and webhook adapter interface; do not add provider-specific billing buttons until webhook signature verification and idempotency are implemented.
4. Continue member/invite lifecycle and audit remaining provider connection/index stores for global identifiers.
