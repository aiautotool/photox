# PhotoX V4 Run 071 — Relay workspace auth tunnel

## Starting point

Run 070 already established the bounded relay tunnel for Desktop resumable media upload requests. The remaining rollout blocker was workspace authentication when the phone can reach the Desktop only through the relay: pairing, access-token refresh and session revoke still tried only direct LAN/Public receiver URLs. A resumable relay upload could therefore become stranded when its bearer token expired even though its durable upload session remained valid.

## Implemented

### Explicit auth routes over the existing relay tunnel

The relay/Desktop proxy now permits only these additional authenticated POST routes:

- `/api/v1/auth/pair`
- `/api/v1/auth/refresh`
- `/api/v1/auth/revoke`

This is intentionally not a generic `/api/v1/auth/*` proxy. Unsupported auth routes remain rejected.

The relay hop still requires both the target Desktop id and the Desktop pair token. Request and response bodies retain their existing bounds. Only the existing request-header allowlist is forwarded. The relay pair token is consumed at the Desktop tunnel boundary and is not forwarded to the local receiver, while workspace bearer/challenge headers are preserved for the receiver's authoritative authentication logic.

### Mobile auth candidate fallback

Mobile workspace session exchange and refresh now try available direct LAN/Public receiver candidates first and then the paired relay endpoint using:

- `x-photosync-relay-desktop-id`
- `x-photosync-pair-token`

The same candidate set is available for session revoke. Tokens stay in request headers/body according to the existing auth contract and are never placed in the URL.

### Regression coverage

Desktop tunnel regression coverage now verifies that pair, refresh and revoke are the only new auth routes accepted, that the relay pair credential is stripped before local forwarding, and that the workspace authorization header is preserved.

The first CI run for this batch passed repository tests but caught a Mobile TypeScript inference error in the new direct/relay candidate union. The candidate arrays were then explicitly typed as `AuthCandidate[]` and the full repository gate was rerun successfully.

## Validation

Code HEAD `5daed43849ee7398b2e34a1f6ec8bba01fe9fb36` passed GitHub Actions CI run 962 (`34133940680`):

- npm install: PASS
- repository unit/integration tests: PASS
- TypeScript typecheck: PASS
- production build: PASS
- built Desktop renderer smoke: PASS
- electron-builder Linux directory package: PASS
- packaged Desktop application smoke: PASS

Signed iOS/Android artifacts and signed Windows/macOS installers remain NOT VERIFIED in this environment.

## P0 requirements carried forward

1. Google Drive allocation must never use a fixed 10 GiB cap. Default PhotoX allocation remains two-thirds of each Google account's authoritative total quota, bounded by authoritative remaining provider bytes and the safety reserve, with a configurable per-account ratio.
2. Google Photos migration remains Picker-selected only, with a durable migration ledger and append-only destination behavior to Google Photos or Google Drive. PhotoX must not advertise unrestricted Google Photos library crawling.
3. Web and Desktop continue to share the same React UI/components/styles through the shared `DesktopBridge`, with Electron IPC and authenticated HTTP/WebSocket adapters plus secure public deployment controls.

## Remaining risks / next batch

The auth prerequisite for relay-only resumable operation is now present, but the Mobile upload transport policy still treats relay as the legacy whole-file transport. The next prioritized batch is to switch the relay upload path to resumable end-to-end while preserving durable Mobile session ownership, Desktop-authoritative `acknowledgedBytes`, 409 offset reconciliation, auth refresh and cancellation semantics. Add relay-path integration tests for restart/network interruption before reducing the legacy whole-file compatibility path.

After relay resumable rollout, harden resumable audit actor attribution so multi-member workspaces record the authoritative authenticated user rather than a legacy owner-compatible identity.

Physical Android/iOS network-loss/process-kill/restart acceptance, live Google Drive/Google Photos acceptance, real TLS/reverse-proxy/WebSocket/Range deployment and Stripe live E2E remain NOT VERIFIED.