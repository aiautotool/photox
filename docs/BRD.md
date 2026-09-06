# Business Requirements Document — PhotoX

## Vision
Build a private Google-Photos-like backup and library product where iOS/Android devices protect photos/videos through a Desktop/edge node, Desktop/Web provide one shared management experience, and multiple storage providers/accounts can be combined without weakening tenant isolation or media durability.

## Business goals
1. Automatic backup of original media with durable retry/recovery.
2. One unified workspace library across local storage and multiple provider accounts.
3. Allocate Google Drive safely without any fixed 10 GiB PhotoX cap: default per-account PhotoX allocation is `2/3` of that account's authoritative total quota, configurable per account, while always respecting actual provider remaining bytes and a configurable safety reserve.
4. Desktop sync/background services start reliably with the OS and recover interrupted work.
5. Prevent duplicate transfers where possible, verify replicas, and preserve enough independent copies according to replica policy.
6. Support compliant Google Photos migration from user-selected Picker items only, with append-only destination upload, durable ledger, pause/resume/retry and verification.
7. Provide a Web edition using the exact Desktop React UI/components/styles through the shared `DesktopBridge`, secured for public/reverse-proxy exposure with authenticated workspace sessions and server-side roles.

## Scope
Mobile iOS/Android; Desktop Windows/macOS; shared Desktop/Web renderer; workspace/member/device/session model; Local, Google Drive and Telegram providers; media APIs and Range streaming; Google OAuth; multi-account Drive allocation; Google Photos Picker migration; discovery/hash/dedupe; durable jobs; replica verification/repair; albums/search/viewer/editor; onboarding; operations/observability; billing-ready plan/subscription/quota abstractions.

## Critical Google Drive rule
For each Google account:

```text
allocationRatio = accountConfiguredRatio ?? 2/3
allocationLimit = floor(authoritativeTotalQuotaBytes * allocationRatio)
ratioRemaining = max(0, allocationLimit - photoXAppUsedBytes)
providerRemainingAfterReserve = max(0, authoritativeProviderFreeBytes - safetyReserveBytes)
safeAvailable = min(ratioRemaining, providerRemainingAfterReserve)
```

A whole file is eligible only when `safeAvailable >= fileSize`. The allocator must never replace this policy with a fixed 10 GiB cap. If no account safely fits the file, the original remains protected locally and the cloud/replication job enters a truthful blocked/retryable capacity state.

## Google Photos compliance rule
PhotoX may import only items explicitly selected through the current Google Photos Picker API. It must not advertise unrestricted account-wide/full-library crawling. Destination writes to Google Photos are append-only; Google Drive may also be chosen as a destination. Migration state must survive restart and retain enough target/checkpoint identity to verify/retry without avoidable duplicate append-only uploads.

## Main journeys
First setup; create/select workspace; pair mobile device; add provider accounts; automatic backup; Desktop boot synchronization; capacity rollover; replica repair; Google Photos migration; browser access; member/device/session administration; restore/recovery.

## Success metrics
0 storage-policy violations; 0 cross-workspace catalog collisions; no fake/unbacked controls; no duplicate physical upload for the same durable migration target/checkpoint path where recovery data exists; durable restart recovery; verified replica health; repository CI green for every completed code batch.
