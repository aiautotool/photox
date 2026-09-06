# Architecture

PhotoX V4 is a TypeScript-first product with React Native + Expo on iOS/Android, Electron + React on Desktop, and a Web edition that reuses the exact Desktop React renderer through the shared `DesktopBridge` contract. Electron uses IPC/preload adapters; Web uses authenticated HTTP/WebSocket adapters. Desktop is the edge/data-plane node for local media processing and provider replication, while workspace identity, roles, quotas and sessions are enforced as SaaS boundaries.

## Domain entities
- Workspace: tenant/isolation, authorization, quota and billing boundary.
- MediaAsset: immutable logical media item.
- SyncJob / MigrationJob: durable transfer/background state machine.
- StorageAccount: provider account plus authoritative quota snapshot, PhotoX usage and per-account allocation policy.
- StorageObject / Replica: media -> provider/account/remote object mapping and verification state.
- Device / Session: registered edge/mobile identity and scoped authenticated session.

## Google Drive capacity formula
There is **no fixed 10 GiB PhotoX cap**.

For each connected Google Drive account:

```text
allocationRatio = configuredRatio ?? 2/3
allocationLimit = floor(authoritativeProviderTotalBytes * allocationRatio)
ratioRemaining = max(0, allocationLimit - photoXAppUsedBytes)
providerRemainingAfterReserve = max(0, authoritativeProviderFreeBytes - safetyReserveBytes)
safeAvailable = min(ratioRemaining, providerRemainingAfterReserve)
eligible(file) = safeAvailable >= file.size
```

The ratio is configurable per account and defaults to `2/3`. Provider free/total bytes come from the authoritative Google quota response. The safety reserve is configurable per account and is applied in addition to the ratio limit. If an authoritative total is temporarily unavailable, PhotoX still bounds writes by actual provider free bytes minus the safety reserve; it must never substitute a fixed 10 GiB limit.

A file is never split across accounts. All capacity math is performed in bytes.

## Media catalog authority
Desktop runtime media-catalog authority is SQLite. `media-index.json` is legacy-only: it may be prepared and consumed once as an import source during cutover, and JSON exports may exist as offline recovery artifacts, but JSON is not a live runtime writer or second catalog authority.

## Sync design
1. Discover media and establish authoritative workspace/device identity.
2. Read metadata and compute SHA-256.
3. Deduplicate by the product identity rules while preserving tenant isolation.
4. Persist durable queue/job state.
5. Refresh provider quota when stale.
6. Allocate an eligible provider account using the per-account ratio + actual remaining bytes + safety reserve policy.
7. Start/resume provider upload.
8. Verify provider result/checksum/remote identity.
9. Persist replica state and mark media protected only when replica policy is satisfied.
10. Serve Desktop/Web/Mobile library state from authoritative tenant-scoped persistence; media delivery preserves HTTP Range support for video seek/streaming.

## Google Photos migration boundary
Google Photos is a user-selected source through the current Google Photos Picker API. PhotoX must not claim unrestricted full-library crawling. Selected items are staged durably, tracked in a migration ledger, and transferred append-only to another Google Photos account or to a connected Google Drive account with pause/resume/retry/verification semantics.
