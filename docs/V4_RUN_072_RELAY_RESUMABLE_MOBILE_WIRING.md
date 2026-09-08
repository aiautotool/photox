# V4 Run 072 — Relay resumable Mobile wiring

## Scope

This run continued directly from Run 071. The relay already had a bounded allow-listed tunnel for Desktop resumable upload routes plus workspace auth forwarding; the remaining production gap was that Mobile still selected legacy whole-file upload whenever the active/fallback transport was relay.

## Implemented

- Promoted relay to the same resumable upload protocol used by LAN and Public transports.
- Updated the shared Mobile upload policy so:
  - Public => authenticated resumable only, fail closed.
  - LAN => direct authenticated resumable first, authenticated relay resumable fallback.
  - Relay => authenticated resumable only.
- Removed the legacy whole-file relay path from `syncAssetsToLaptop()` transport execution.
- Mobile now points the existing `ResumableUploadClient` at the relay base URL and supplies the relay routing headers (`x-photosync-relay-desktop-id`, `x-photosync-pair-token`) together with refreshed workspace access auth.
- Durable Mobile session storage, Desktop-authoritative `acknowledgedBytes`, 409 offset reconciliation, stale-session recreation, token refresh, cancellation and finalize semantics remain shared with LAN/Public instead of implementing a second relay upload protocol.
- Cancellation remains terminal and does not trigger LAN -> relay fallback, preserving the durable session for a later resume.
- Normalized optional relay headers to a strict `Record<string,string>` before each resumable request; this fixed the TypeScript failure found by CI.
- Updated SDK integration coverage so relay and LAN fallback are asserted as resumable transports.

## Validation

The first code CI exposed two rollout issues in sequence and was not accepted as complete:

1. Before the policy regression update, tests still expected legacy relay whole-file behavior.
2. After tests were aligned, TypeScript rejected the optional relay-header union.

Both were fixed and the full gate was rerun.

Final code validation: GitHub Actions CI run 968 (`34135950987`) on commit `7bf618497168d9c82da39ad553f3029d67c6292f`:

- `npm install` — PASS
- repository tests — PASS
- TypeScript typecheck — PASS
- production build — PASS
- built Desktop renderer smoke — PASS
- electron-builder Linux directory package — PASS
- packaged Desktop application smoke — PASS

Physical Android/iOS restart, process-kill and real network-interruption acceptance remain NOT VERIFIED in this environment. Signed IPA/APK/AAB and signed Windows/macOS installers remain NOT VERIFIED.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains 2/3 of each account's authoritative total quota, bounded by actual provider remaining bytes and safety reserve, with configurable per-account ratio.
2. Google Photos migration remains Picker-selected only with append-only destination upload to another Google Photos account or connected Drive; no unrestricted full-library crawling claim.
3. Web and Desktop continue to share the exact React UI/components/styles through `DesktopBridge`, with authenticated HTTP/WebSocket adapters and public-access security controls.

## Remaining risks

- Relay resumable now uses the same durable protocol in production Mobile code, but physical-device interruption/restart acceptance is still required before calling remote Mobile sync production-ready.
- Resumable post-commit audit attribution still needs authoritative multi-member actor identity rather than the legacy owner-compatible actor path.
- Live Google Drive/Google Photos provider acceptance, real TLS/reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.

## Next prioritized batch

Harden authoritative multi-user actor attribution for resumable upload sessions and post-commit audit/events. Persist or resolve the authenticated user identity under the same workspace/device authority used at session creation, ensure restart/finalize reconciliation cannot fall back to workspace-owner identity, add cross-member isolation regressions, then run the complete repository gate again.
