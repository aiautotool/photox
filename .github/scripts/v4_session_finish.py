from pathlib import Path

def replace(path, old, new):
    p=Path(path); s=p.read_text()
    if old not in s: raise SystemExit(f'anchor missing {path}: {old[:120]}')
    p.write_text(s.replace(old,new,1))

# Preserve media type over relay, otherwise bearer-based video uploads become photos.
replace('relay/src/server.ts',
"authorization: string;\n  deviceId: string;",
"authorization: string;\n  mediaType: string;\n  deviceId: string;")
replace('relay/src/server.ts',
"authorization: clean(String(req.headers['authorization'] || '')),\n        deviceId:",
"authorization: clean(String(req.headers['authorization'] || '')),\n        mediaType: clean(String(req.headers['x-photosync-media-type'] || 'photo')),\n        deviceId:")
replace('relay/src/server.ts',
"...(item.authorization ? { authorization: item.authorization } : {}),\n        'x-photosync-device-id':",
"...(item.authorization ? { authorization: item.authorization } : {}),\n        'x-photosync-media-type': item.mediaType,\n        'x-photosync-device-id':")

# Update V4 plan to reflect implemented session exchange and the new next batch.
p=Path('docs/V4_SAAS_PLAN.md'); s=p.read_text()
s=s.replace("4. **Pairing v2 is workspace-aware but session exchange is transitional**\n   - Desktop QR v2 carries workspace ID, workspace role, desktop device ID, short-lived challenge expiry and capabilities.\n   - Mobile stores this workspace pairing context in SecureStore and uses it for LAN/public/relay requests while valid.\n   - legacy v1 pair-code/pair-token compatibility remains temporarily available until a v2 challenge is exchanged for normal access/refresh tokens.",
"4. **Pairing v2 now exchanges into durable workspace sessions**\n   - Desktop QR v2 carries workspace ID, workspace role, desktop device ID, short-lived challenge expiry and capabilities.\n   - Mobile exchanges the challenge for a 15-minute JOSE access token plus durable refresh session, persists them in SecureStore, refreshes before expiry, and revokes on forget.\n   - Desktop registers/refreshes the mobile WorkspaceDevice, enforces active membership/device state, and accepts bearer scopes on status/library/media/download/delete.\n   - Relay preserves Authorization and workspace headers end-to-end; legacy v1 pair-code/pair-token compatibility remains temporarily available only for old clients.")
s=s.replace("Legacy V3 pair-code sessions remain temporarily valid during migration. Pairing v2 no longer relies on pair-code for modern relay-to-desktop authorization: the workspace challenge is propagated through Relay and verified by the same shared Desktop challenge manager used by LAN/public requests. V1 devices retain pair-code/pair-token fallback until the access/refresh session exchange endpoint is complete.",
"Legacy V3 pair-code sessions remain temporarily valid during migration. Pairing v2 exchanges its one-time workspace challenge for a scoped JOSE access token and SQLite-backed refresh session. Modern LAN/public/relay media requests carry Bearer authorization; Relay forwards it to the desktop receiver. V1 devices retain pair-code/pair-token fallback only for compatibility while upgraded clients use normal sessions.")
s=s.replace("Implemented transitional v2 flow:","Implemented v2 session flow:")
s=s.replace("- Mobile parses/persists v2 workspace pairing context in SecureStore and attaches workspace/challenge headers for modern LAN/public/relay operations.\n- expired or invalid v2 challenges are rejected.\n- v1 pairing remains compatible through legacy pair-code/pair-token fallback.\n\nNext pairing step: exchange the short-lived challenge for a workspace-scoped access/refresh session, register/revoke the mobile device session, and stop using pair-code as authorization for v2 clients entirely.",
"- Mobile parses/persists v2 workspace pairing context, immediately exchanges the short-lived challenge for access/refresh credentials, refreshes the access token before expiry, and sends Bearer authorization for modern LAN/public/relay operations.\n- Desktop stores refresh sessions in SQLite, registers the mobile as a WorkspaceDevice, enforces membership/device revocation, and audits device registration/session pairing.\n- Relay forwards Bearer authorization, workspace ID, media type and upload metadata to the Desktop receiver.\n- expired/invalid challenges, expired/revoked sessions, revoked devices and workspace mismatches are rejected.\n- v1 pairing remains compatible through legacy pair-code/pair-token fallback for migration only.")
s=s.replace("- [ ] Exchange v2 pairing challenge for workspace-scoped access/refresh session and revoke device sessions server-side.","- [x] Exchange v2 pairing challenge for workspace-scoped JOSE access/refresh session, register the mobile device, refresh before expiry, enforce active device/membership state and revoke sessions on forget.")
s=s.replace("1. Add a v2 pairing exchange endpoint that consumes the short-lived challenge and returns workspace-scoped access + refresh tokens, registers the mobile device, supports session revocation, and removes pair-code fallback for upgraded clients.\n2. Add `workspace_id` to media index/provider connection rows with backward-safe migration; enforce workspace scope in list/read/delete/upload/replica operations and add cross-tenant tests.\n3. Replace static Web edge bootstrap role/workspace configuration with verified SaaS access tokens and refresh-session flow.",
"1. Add `workspace_id` to media index/provider connection rows with backward-safe migration; enforce workspace scope in list/read/delete/upload/replica operations and add cross-tenant tests.\n2. Replace static Web edge bootstrap role/workspace configuration with the same verified SaaS access/refresh session flow now used by Mobile.\n3. Add device/session management APIs and shared Mobile/Desktop/Web UX for listing devices, revoking a device and invalidating all associated refresh sessions.")
p.write_text(s)
print('session finishing patch applied')
