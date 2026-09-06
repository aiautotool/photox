# Functional Requirements Specification — PhotoX

FR-001 Mobile requests media permission and handles denied/limited/full states.

FR-002 Mobile discovers image/video assets and persists durable sync progress/cursors.

FR-003 Exact duplicate detection uses authoritative media identity rules such as SHA-256 + file size while preserving workspace isolation.

FR-004 Durable queue states cover discovery, hashing, queued, uploading, verifying, protected and failed/blocked recovery.

FR-005 Backup settings include Wi-Fi policy, charging policy, photos, videos and background backup where supported by the OS.

FR-006 Desktop supports multiple Google OAuth accounts. Passwords are never stored.

FR-007 Provider refresh tokens/credentials must use approved secure credential storage and be redacted from logs/API/UI.

FR-008 Provider quota is refreshed from an authoritative provider response before allocation when stale.

FR-009 Google Drive allocation must not use a fixed 10 GiB PhotoX cap. The default per-account allocation ratio is `2/3` of authoritative total quota and is configurable per account.

FR-010 For an account with authoritative total quota, `allocationLimitBytes = floor(providerTotalBytes * allocationRatio)` and `ratioRemainingBytes = max(0, allocationLimitBytes - appUsedBytes)`.

FR-011 Provider headroom must also respect actual remaining provider bytes and the configured safety reserve: `providerRemainingAfterReserveBytes = max(0, providerFreeBytes - safetyReserveBytes)`.

FR-012 Effective writable capacity is `safeAvailable = min(ratioRemainingBytes, providerRemainingAfterReserveBytes)`. If authoritative total quota is temporarily unavailable, PhotoX may omit the ratio bound but must still enforce actual free bytes minus safety reserve; it must not substitute a fixed cap.

FR-013 A file must be placed entirely in one account and is eligible only when `safeAvailable >= fileSize`.

FR-014 The default allocator chooses an eligible account with the greatest current safe available capacity unless a higher-level replica/provider policy requires another eligible destination.

FR-015 If no account safely fits, the durable job enters a truthful blocked/no-capacity state and the original remains available from an already durable source.

FR-016 Large provider uploads use resumable transfer/checkpoint semantics where the provider supports them.

FR-017 Uploaded media is verified and remote provider/account/object identity is persisted before the replica is considered verified/protected.

FR-018 Desktop can start at login/startup and run background sync without foreground UI.

FR-019 Desktop runtime media-catalog authority is transactional SQLite. `media-index.json` is permitted only as a one-time legacy import source or offline recovery/export artifact, never as a concurrent live writer.

FR-020 Unified media state resolves logical media identity to workspace-scoped provider/account/object replicas.

FR-021 Immutable original media is not overwritten by edits; edit metadata/derivatives are revisioned or stored separately.

FR-022 Automatic backup/migration must never auto-delete original source media as a side effect of successful upload unless an explicit user-facing delete workflow is invoked.

FR-023 Every long-running job records correlation identity, progress, retries/checkpoints and sanitized errors, and survives process termination/reboot when durable execution is required.

FR-024 Target native platforms are iOS, Android, Windows and macOS. Web reuses the exact Desktop React UI/components/styles via the shared `DesktopBridge` contract.

FR-025 Web uses authenticated HTTP/WebSocket bridge adapters with workspace/session authorization and server-side role enforcement. Public exposure must apply CORS/CSRF/rate-limit/audit controls as applicable and preserve HTTP Range media streaming.

FR-026 Google Photos migration source selection uses the current Google Photos Picker API only. The product must not claim or implement unrestricted full-library crawling through unsupported APIs.

FR-027 Picker-selected photos/videos are staged durably before session-bound Picker URLs expire and are tracked in a durable migration ledger with account selection, progress, pause/resume/retry and verification.

FR-028 Google Photos destination writes are append-only. A migration may alternatively target a connected Google Drive account. Restart recovery must reuse durable target/checkpoint identity so verification does not cause avoidable duplicate destination uploads.

FR-029 Workspace/tenant identity is authoritative for catalog, jobs, providers, sessions, replicas, operations and administration; identical media/job IDs in different workspaces must not collide.

FR-030 Primary controls must be backed by real logic and should be accessible by keyboard/screen reader where the platform supports it; unsupported functionality stays hidden/disabled with a truthful reason rather than appearing as a mock control.
