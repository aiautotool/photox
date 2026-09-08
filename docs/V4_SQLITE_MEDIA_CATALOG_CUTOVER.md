# PhotoX V4 — SQLite Media Catalog Cutover

## Purpose
Move the Desktop/Web media catalog from legacy `media-index.json` to transactional SQLite without dual-writing, without changing runtime semantic operations, and without weakening workspace isolation, deletion tombstones, replica state, ingest crash recovery, diagnostics or rollback safety.

## Production authority status
SQLite is now the sole active Desktop media-catalog authority.

`media-index.json` has only two permitted roles:
1. one-time legacy import source during cutover; and
2. offline recovery/export artifact produced or consumed while Desktop is stopped and exclusive catalog authority is held by the operator tool.

It must never be reintroduced as a concurrent runtime writer or second live catalog.

## Completed foundation
- `SqliteMediaIndexCatalog` owns composite `workspace_id + media_key` identity, schema metadata and transactional append/patch/remove semantics.
- One-time JSON import is strict/idempotent, validates identities/duplicates, records versioned migration metadata + source SHA-256, creates/fsyncs backup material and commits rows + marker transactionally.
- `mediaCatalogBackend.ts` is the startup authority boundary and validates schema/import-marker invariants before returning runtime handles.
- Desktop production startup activates one `ActiveMediaCatalogBackend` before ingest recovery, usage bootstrap, receiver/Web startup, deletion replay, video processing or Drive retry work.
- Desktop runtime reads use SQLite `listAll`/`listWorkspace`; ingest/video/replica/delete mutations use the active backend writer.
- Legacy workspace-ID preparation is crash-safe, temp-file based, fsynced before atomic rename, cleans orphan `*.migrating` files on restart and is idempotent.
- Startup/restart regressions cover first import, already-imported restart, post-cutover growth, source mutation, fresh install, imported-row loss, durable backup without marker, post-commit/pre-activation restart, corrupt SQLite and unsupported newer schema.
- Runtime shutdown closes the active catalog. Regression gates fail if the legacy JSON runtime writer is reintroduced or recovery runs before SQLite activation.
- `mediaCatalogDiagnostics.ts` provides live catalog health. Workspace-safe diagnostics redact local backup paths/source fingerprints; trusted local operators may access recovery-only metadata.
- Web `admin`/`owner` diagnostics are role-gated and always redacted. Trusted Desktop operator diagnostics may expose local recovery metadata.
- Shared Desktop/Web React renderer contains a real Operations drawer backed by `DesktopBridge.getMediaCatalogDiagnostics()`; Web role denial hides the surface and renderer applies an additional redaction pass.
- Runtime and offline tools share an exclusive `<sqlite>.authority.lock`. Live Desktop ownership blocks export/restore, offline operator ownership blocks Desktop startup, malformed locks fail closed, and stale crash locks are reclaimed only after the recorded PID is proven absent.
- Offline `catalog:export` creates an atomic JSON recovery artifact without turning JSON into a live writer.
- Offline `catalog:restore` accepts only SHA-256-verified exports, takes exclusive authority, creates a pre-restore backup and replaces only media rows in one SQLite transaction while preserving schema/migration metadata.
- Process-level kill tests prove stale lease reclamation after abrupt termination.
- Deterministic restore killpoints cover `backup-created`, `transaction-started` and `commit-complete`; restart observes either the complete original catalog before commit or complete restored catalog after commit, never a half-restored state.

## Documentation audit — current progress
Completed in the current audit batch:
- root `README.md` now describes SQLite runtime authority, current Desktop/Web architecture, compliant Google Photos Picker migration and the real Drive allocation policy.
- `docs/ARCHITECTURE.md` no longer describes the obsolete Tauri/Rust + fixed-cap model and now records the current React Native/Electron/shared-Web architecture.
- `docs/BRD.md` removes the fixed 10 GiB business rule and carries the 2/3 authoritative quota requirement, Google Photos Picker-only boundary and shared Web/Desktop SaaS requirements.
- `docs/FRS.md` replaces hard-coded 10 GiB functional requirements with the runtime allocation formula and explicitly defines SQLite as runtime media-catalog authority.
- `docs/RUN_REAL_SYNC.md` removes the obsolete 10 GiB storage rule and updates pairing/session/catalog/provider behavior.

Still to audit: secondary historical/integration documents that may describe pre-cutover JSON writers or old product architecture. Historical run notes may retain past-state descriptions when clearly labeled as historical; current operator/product instructions must not describe JSON as runtime authority.

## Offline operator export
With PhotoX Desktop fully stopped:

```bash
npm --workspace @photosync/desktop run catalog:export -- --sqlite "/path/to/photosync-state/media-catalog.sqlite" --out "/safe/path/photox-media-catalog-rollback.json"
```

Record the emitted SHA-256 together with the artifact. Keep the export outside the active state directory when possible. Do not replace legacy JSON or use the export as a second writer while PhotoX is running.

## Offline operator restore
With PhotoX Desktop fully stopped:

```bash
npm --workspace @photosync/desktop run catalog:restore -- \
  --sqlite "/path/to/photosync-state/media-catalog.sqlite" \
  --from "/safe/path/photox-media-catalog-rollback.json" \
  --sha256 "<sha256-from-catalog-export>" \
  --backup "/safe/path/pre-restore-current-catalog.json"
```

The restore validates source hash and tenant/media-key uniqueness before mutation, holds exclusive authority, writes a pre-restore backup, performs transactional replacement, verifies restored rows, closes SQLite, then releases authority. Missing/corrupt input, SHA mismatch, duplicate identity, missing/corrupt SQLite or malformed authority lock fail closed.

After restore, start PhotoX normally. SQLite remains the sole runtime catalog.

## Active cutover work
1. Continue the secondary documentation audit and remove only current-state references that still present `media-index.json` as a runtime catalog/writer.
2. Add renderer-level DOM lifecycle coverage for the Operations drawer when a suitable DOM harness is available; current view-model tests plus Electron/Web transport integration already cover redaction/role policy.
3. Run real OS/physical power-loss acceptance on supported release platforms; CI process-kill tests prove transactional semantics but do not substitute for hardware/filesystem power-loss testing.

## Non-negotiable product constraints carried through cutover
- Google Drive allocation has **no fixed 10 GB cap**. Default PhotoX allocation is `2/3` of each account's authoritative total quota, bounded by actual provider remaining bytes and the configured safety reserve, with configurable per-account ratio.
- Google Photos migration is **Picker-selected only** under the current Google Photos Picker API. Destination Google Photos writes are append-only; Google Drive is also a supported destination. The product must not claim unrestricted full-library crawling.
- Web and Desktop share the same React UI/components/styles and `DesktopBridge` contract, with Electron IPC and authenticated HTTP/WebSocket adapters respectively.
- Workspace/tenant identity remains authoritative at every catalog operation; identical media keys in different workspaces must never collide.

## Exit criteria
SQLite is the sole active Desktop media catalog at the production lifecycle boundary. Every completed code batch must keep repository tests, TypeScript typecheck, production build, Desktop renderer smoke, electron-builder packaging and packaged Desktop smoke green on the final branch head. Platform-signed installers, live provider-account acceptance, public TLS/reverse-proxy acceptance and physical power-loss acceptance remain explicitly **NOT VERIFIED** until run in the required environment.
