# PhotoX V4 — Tenant Isolation Progress

This document records the completed tenant-isolation batches and the immediate next priorities. It supplements `V4_SAAS_PLAN.md`.

## Completed in the original tenant-isolation batch

- Added generic workspace-row helpers in `@photosync/core`:
  - backward-safe migration of legacy rows without `workspaceId` into the default workspace;
  - filter rows by workspace;
  - replace one workspace's rows without touching another workspace;
  - find a keyed row only inside a requested workspace.
- Added cross-tenant unit tests proving:
  - the same media key may exist in two workspaces without cross-reading;
  - replacing workspace A rows preserves workspace B rows;
  - a scoped replacement rejects rows owned by a different workspace.
- Desktop media index rows now carry `workspaceId`.
- Legacy `media-index.json` rows are migrated in place to the default legacy workspace.
- Desktop media operations now accept/use workspace scope for:
  - list/read;
  - upload/duplicate detection;
  - delete;
  - video processing state updates;
  - cloud media fallback;
  - Google Drive replica persistence.
- Bearer-authenticated receiver requests derive the workspace from the verified access principal and use that workspace for media lookup/mutation.
- Google Drive saved-account records now carry `workspaceId`.
- Legacy Google Drive credential JSON files are migrated to the default workspace when read.
- Google Drive runtime lookup and cloud upload use the media row's workspace.
- Provider removal checks workspace ownership before deleting the saved credential.
- Replica mutations persist only inside the media row's workspace and include workspace identity in storage-update events.

## Run 17 — reusable + durable media-cloud catalog isolation

Completed:

- Added `workspaceId` to `MediaCloudItem`/summary and made every media-cloud query explicitly workspace-bound.
- `MemoryMediaCloudRepository` now uses a composite workspace/asset key, so identical `assetId` values in separate workspaces cannot overwrite or read each other.
- `MediaCloudCatalog` is constructed with an immutable workspace boundary and applies it to register/get/list/remove and replica mutations; summarizing a foreign-workspace item fails closed.
- `MediaCloudStatsService` now reads only the requested workspace, preventing provider/account/replica statistics from aggregating another tenant.
- `SqliteMediaCloudRepository` now uses `(workspace_id, asset_id)` as its durable primary key and applies workspace predicates to get/list/remove/upsert operations.
- Existing legacy `photox_media_cloud` tables are rebuilt transactionally when the tenant-aware repository is first opened. Old rows are assigned only to the caller-designated legacy workspace, and `workspaceId` is written into migrated `item_json`.
- Added integration coverage proving two workspaces can persist the same `assetId` with different files/providers, delete one independently, and retain isolation across SQLite close/reopen.
- Added migration coverage proving an unscoped legacy row is visible only to the designated legacy workspace after schema upgrade.
- The first CI attempt correctly exposed the old global `SqliteMediaCloudRepository`; that failure was fixed rather than bypassed. The corrected code batch passed repository tests, full TypeScript typecheck and full production build.

## Validation

Tenant-isolation batches run the repository-required sequence:

- `npm install`
- `npm test`
- `npm run typecheck`
- `npm run build`

A batch is not marked complete until the final `v4` HEAD GitHub CI has all four steps green.

## Remaining tenant-isolation work

1. Complete a common tenant-owned provider connection/credential contract for Telegram and all future providers; Google Drive and Google Photos are already workspace-scoped.
2. Audit remaining reusable SDK indexes (video/job/derived-media metadata) and add workspace identity where those records can be shared by multiple workspaces rather than remaining edge-local.
3. Add device/session management APIs and shared Mobile/Desktop/Web UX for device listing, revoke, and session invalidation.
4. Add authoritative workspace/plan/usage APIs and expose them in Desktop/Web and Mobile.
5. Continue central SaaS control-plane extraction so Web/Mobile sessions can be issued authoritatively across multiple edge nodes rather than relying on one desktop edge as the identity origin.
6. Add real-browser shared React UI/media smoke coverage and live Google OAuth migration verification with real accounts outside CI.

## Compatibility

Branch `v3` remains untouched. Legacy v4 data without workspace fields is migrated into the configured/designated legacy workspace rather than discarded or silently exposed to another tenant.
