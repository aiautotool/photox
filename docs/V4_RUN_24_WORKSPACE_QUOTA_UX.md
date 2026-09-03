# V4 Run 24 — Shared Workspace / Quota UX

## Goal

Surface the authoritative workspace, plan, usage, quota and entitlement state completed in Run 23 in the same React UI used by Electron Desktop and Web. Do not add pricing, checkout or upgrade controls until PhotoX has an authoritative subscription snapshot/control-plane implementation.

## Implemented

- Extended the shared `DevicesPage` to load `getWorkspaceOverview()` alongside the authoritative workspace device registry.
- Displays the current workspace name, membership role, workspace status and current technical plan.
- Displays authoritative utilization for:
  - managed storage;
  - monthly ingress;
  - members;
  - devices;
  - storage providers;
  - public shares.
- Shows remaining quota and percentage when a technical limit exists; unlimited dimensions are explicitly labeled as having no technical limit.
- Adds warning presentation at 75% utilization and critical presentation at 90% utilization without changing or duplicating backend quota enforcement.
- Displays entitlement/capability state for remote access, public sharing, semantic search, priority video processing and target original replica count.
- Preserves the existing authoritative device/session list and revoke flows on the same page.
- Uses responsive styles shared by Electron Desktop and Web because both editions render the same React tree through the `DesktopBridge` contract.
- No billing or subscription mutation UI was added because the subscription lifecycle is not yet authoritative.

## Validation

Repository CI is the required validation pipeline and runs dependency installation, the complete repository test suite, TypeScript typecheck and production build. The final Run 24 HEAD must be green before this batch is considered complete.

## Carried-forward product requirements

- Google Drive PhotoX allocation remains based on authoritative provider quota, defaulting to 2/3 of total quota while respecting actual free bytes, safety reserve and per-account configurable allocation ratio. No fixed 10 GB allocation cap.
- Google Photos migration remains Picker-selected only, with durable append-only Google Photos or connected Google Drive destinations; PhotoX must not advertise unrestricted full-library crawling.
- Web remains the same Desktop React UI/components/styles through a shared `DesktopBridge`, with authenticated HTTP/WebSocket transport and existing workspace/session/role/CSRF/rate-limit/audit/Range-streaming protections.

## Next priorities

1. Add Mobile workspace/quota/device UX using the same authenticated workspace/session model rather than a separate mobile-only quota model.
2. Build an authoritative subscription snapshot/control-plane abstraction before exposing billing/change-plan controls.
3. Complete member/invite lifecycle and operations/audit UX.
4. Continue the final provider connection/index audit for any remaining global identifiers.
5. Keep live Google OAuth migration and signed iOS/Android release validation as explicit production verification work.
