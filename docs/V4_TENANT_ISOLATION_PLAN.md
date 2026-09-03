# PhotoX V4 — Tenant Isolation Plan

This plan supplements `V4_SAAS_PLAN.md` and records the current tenant-isolation hardening state. V3 remains frozen; all work here is V4-only.

## Completed

- Desktop media index operations are workspace-scoped.
- Google Drive account ownership/config and Google Photos credential/migration access are workspace-scoped.
- `@photox/media-cloud` catalog, replicas, stats and SQLite persistence use `(workspaceId, assetId)` boundaries with backward-safe legacy migration.
- Telegram provider contracts now require `workspaceId` on account config and stored media.
- `TelegramAccountService` is bound to a single workspace; config list/resolve/remove are workspace-scoped.
- Telegram bot token physical secret keys are namespaced by workspace, preventing two workspaces using the same logical secret key from colliding.
- Telegram memory config/media repositories use workspace-aware composite identity.
- Telegram media stats are workspace-bound.
- Cross-tenant integration coverage proves identical Telegram account IDs, logical secret keys and file IDs remain isolated and one workspace cannot remove the other workspace's config/token/media.

## Still open — highest priority

1. `@photox/jobs` and `SqliteJobRepository` are still keyed globally by job `id`; add `workspaceId`, bind queues/repositories to a workspace and provide backward-safe legacy migration plus cross-tenant tests.
2. `@photox/video-media` and `SqliteVideoMediaRepository` are still keyed globally by `assetId`; add workspace ownership for probe/thumbnail/preview/derived-media records and migrate legacy rows only into the designated legacy workspace.
3. Audit remaining derived-media, reconciliation, integrity and delivery indexes for global `assetId`/`replicaId` keys and bind them to workspace context where persistence or mutation crosses tenant boundaries.
4. Wire Telegram into Desktop/Web only after a durable workspace-scoped config/media repository and OS-backed secret store are available; do not expose bot tokens through renderer/Web/audit payloads.
5. Continue uniform entitlement/quota enforcement for provider/admin writes after tenant ownership is guaranteed.

## Validation rule

Every implementation batch must pass repository tests, TypeScript typecheck and full production build in CI before being marked complete. Live Google OAuth migration and signed iOS/Android release builds remain `NOT VERIFIED` when credentials/signing environments are unavailable.
