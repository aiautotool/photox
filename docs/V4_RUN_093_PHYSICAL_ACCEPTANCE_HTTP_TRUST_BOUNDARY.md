# V4 Run 093 — Physical Acceptance HTTP Trust Boundary

## Goal

Continue directly from Run 092 and harden the production physical-device resumable acceptance HTTP boundary. Prove transport-level fail-closed behavior for corrupt server-authority state and authenticated workspace/device/session/asset mismatches, while keeping the append-only evidence ledger unchanged and returning only coarse public errors.

## Analysis

The existing acceptance endpoint already takes workspace/device identity only from the authenticated principal and the physical acceptance ingestion path derives offset/quota/catalog/final verification exclusively from the independent server-authority ledger. Internal authority errors intentionally fall through the resumable HTTP mapper to a coarse `500 { error: "RESUMABLE_UPLOAD_FAILED" }` response.

The missing production-shaped regression was proof that corrupt authority persistence and each identity-binding mismatch cannot append acceptance evidence or leak internal authority codes/identifiers through the HTTP transport.

## Implemented

Added `desktop/electron/resumableAcceptanceHttpBoundary.test.ts` using the real production resumable runtime composition and HTTP handler.

Coverage now proves:

- corrupt `physical-resumable-server-authority.json` fails closed at the acceptance endpoint;
- authenticated workspace mismatch fails closed;
- authenticated device mismatch fails closed;
- submitted session mismatch fails closed;
- submitted asset mismatch fails closed;
- every rejection returns only `500 { error: "RESUMABLE_UPLOAD_FAILED" }`;
- responses do not contain workspace/device/session/asset identities or internal `PHYSICAL_RESUMABLE_*` authority codes;
- the append-only physical acceptance evidence ledger remains at zero records before and after every rejected request.

No production endpoint, permission, UI control, acceptance override or error-detail expansion was added. Normal media ingest behavior is unchanged.

## Validation

Code HEAD `da2ad4a5abc7edae8d96728f1aaadabf2ebfdc77` passed the executable CI stages in run 1071 (`34217387724`):

- dependency install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- Electron directory package: PASS
- packaged Desktop application smoke: PASS

The final workflow housekeeping steps were still completing when this plan delta was written; the executable validation stages above were green.

## P0 invariants carried forward

1. Google Drive allocation must never use a fixed 10 GB PhotoX cap. Default allocation remains 2/3 of each Google account's authoritative total quota, bounded by actual remaining provider bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected source only through the current Google Photos Picker API, with append-only destination upload to another Google Photos account or a connected Google Drive account. PhotoX must not advertise unrestricted full-library crawling.
3. Desktop and Web continue to use the same React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters. Public exposure retains workspace/session auth, role enforcement, CORS/CSRF/rate-limit/audit controls as applicable.

## Remaining risks / NOT VERIFIED

- Real iOS and Android hardware: network interruption → OS process kill → app restart → authoritative status → exact-byte resume → finalize → acceptance submission.
- Signed IPA/APK/AAB.
- Signed Windows/macOS installers.
- Live multi-account Google Drive quota/allocation/provider acceptance.
- Live Google Photos Picker migration between real accounts and to Google Drive.
- Physical power-loss recovery.
- Production TLS/reverse-proxy/WebSocket/Range deployment.
- Stripe live end-to-end billing.

## Next prioritized batch

Move provider acceptance forward while preserving the completed physical acceptance trust boundary. First add production-visible Google Drive quota-allocation acceptance diagnostics and a live-safe verification harness that compares PhotoX's effective allocation against authoritative Drive quota (`default ratio = 2/3`, provider remaining bytes, safety reserve, configurable account ratio) without mutating user data. Then extend the Google Photos Picker migration acceptance harness around real Picker-selected sessions, durable migration ledger/progress/retry/verification and append-only destination behavior, without introducing unrestricted library crawling claims.
