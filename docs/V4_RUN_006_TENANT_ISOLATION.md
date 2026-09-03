# PhotoX V4 — Tenant Isolation Progress

This document records the completed tenant-isolation batch and the immediate next priorities. It supplements `V4_SAAS_PLAN.md`.

## Completed in this batch

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

## Validation

The integration and follow-up fix batches each ran:

- `npm install`
- `npm test`
- `npm run typecheck`
- `npm run build`

All completed successfully before their commits were pushed.

## Remaining tenant-isolation work

1. Replace the Web edge static bootstrap token/role/workspace configuration with the same JOSE access/refresh session flow used by Mobile. Every Web handler and signed media URL must bind to the authenticated principal workspace.
2. Namespace Google Photos OAuth connections and migration jobs by workspace. Google Drive is scoped now; Google Photos credentials still need the same ownership contract.
3. Ensure Telegram and all future provider credential stores implement a common tenant-owned provider connection contract.
4. Add device/session management APIs and shared Mobile/Desktop/Web UX for device listing, revoke, and session invalidation.
5. Add authoritative workspace/plan/usage APIs and expose them in Desktop/Web and Mobile.
6. Continue Google Photos migration hardening: streaming large files, restart-safe per-file resumable checkpoints, throughput/ETA, and live OAuth verification with real accounts.

## Compatibility

Branch `v3` remains untouched. Legacy v4 data without workspace fields is migrated into the configured default workspace rather than discarded or re-created.
