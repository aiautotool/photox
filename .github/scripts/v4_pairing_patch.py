from pathlib import Path


def replace(path, old, new):
    p=Path(path); text=p.read_text()
    if old not in text:
        raise SystemExit(f'missing pattern in {path}: {old[:100]!r}')
    p.write_text(text.replace(old,new,1))

# tunnel client: emit v2 workspace-bound pairing payload while preserving relay pair token compatibility.
p='desktop/electron/tunnelClient.ts'
text=Path(p).read_text()
text=text.replace("type Options = {\n  stateDir: string;\n  relayUrl: string;", "export type TunnelPairingContext = { workspaceId:string; workspaceRole:'owner'|'admin'|'member'|'viewer'; desktopDeviceId:string; challenge:string; challengeExpiresAt:number; capabilities:string[] };\n\ntype Options = {\n  stateDir: string;\n  relayUrl: string;\n  getPairingContext?: () => Promise<TunnelPairingContext>;")
text=text.replace("  async getState(): Promise<TunnelState> {\n    const identity = await this.getIdentity();\n    const payload = JSON.stringify({\n      v: 1,\n      relayUrl: this.options.relayUrl,\n      desktopId: identity.desktopId,\n      pairToken: identity.pairToken,\n    });", "  private async pairingPayload(identity: TunnelIdentity) {\n    const context = await this.options.getPairingContext?.();\n    return JSON.stringify(context ? {\n      v: 2, relayUrl: this.options.relayUrl, desktopId: identity.desktopId, pairToken: identity.pairToken,\n      workspaceId: context.workspaceId, workspaceRole: context.workspaceRole, desktopDeviceId: context.desktopDeviceId,\n      pairingChallenge: context.challenge, challengeExpiresAt: context.challengeExpiresAt, capabilities: context.capabilities,\n    } : { v: 1, relayUrl: this.options.relayUrl, desktopId: identity.desktopId, pairToken: identity.pairToken });\n  }\n\n  async getState(): Promise<TunnelState> {\n    const identity = await this.getIdentity();\n    const payload = await this.pairingPayload(identity);")
text=text.replace("      pairingPayload: JSON.stringify({ v: 1, relayUrl: this.options.relayUrl, desktopId: identity.desktopId, pairToken: identity.pairToken }),", "      pairingPayload: await this.pairingPayload(identity),")
Path(p).write_text(text)

# internet tunnel: issue workspace challenge, carry it through relay and verify before local ingest.
p='desktop/electron/internetTunnel.ts'; text=Path(p).read_text()
text=text.replace("import { PhotoSyncTunnelClient, type TunnelIdentity } from './tunnelClient.js';", "import { PhotoSyncTunnelClient, type TunnelIdentity } from './tunnelClient.js';\nimport { WorkspacePairingChallengeManager } from './pairingChallenge.js';\nimport crypto from 'node:crypto';\nimport os from 'node:os';")
text=text.replace("let client: PhotoSyncTunnelClient | null = null;", "let client: PhotoSyncTunnelClient | null = null;\nconst WORKSPACE_ID=process.env.PHOTOX_WORKSPACE_ID||'legacy-personal';\nconst DESKTOP_DEVICE_ID=`desktop_${crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0,20)}`;\nconst pairingChallenges=new WorkspacePairingChallengeManager(WORKSPACE_ID,DESKTOP_DEVICE_ID,'owner');")
text=text.replace("  const pairToken = decodeURIComponent(response.headers.get('x-photosync-pair-token') || '');\n  if (pairToken !== identity.pairToken) throw new Error('Rejected upload with invalid pairing token');", "  const pairToken = decodeURIComponent(response.headers.get('x-photosync-pair-token') || '');\n  if (pairToken !== identity.pairToken) throw new Error('Rejected upload with invalid pairing token');\n  const pairingChallenge=decodeURIComponent(response.headers.get('x-photosync-pairing-challenge')||'');\n  const workspaceId=decodeURIComponent(response.headers.get('x-photosync-workspace-id')||'');\n  if (!pairingChallenges.verify({challenge:pairingChallenge,workspaceId})) throw new Error('Rejected upload with expired or invalid workspace pairing challenge');")
text=text.replace("      'x-photosync-pair-code': await localPairCode(),", "      'x-photosync-pair-code': await localPairCode(),\n      'x-photosync-pairing-challenge': pairingChallenge,\n      'x-photosync-workspace-id': workspaceId,")
text=text.replace("    relayUrl,\n    onUploadReady:", "    relayUrl,\n    getPairingContext: async()=>{const x=pairingChallenges.issue();return {workspaceId:x.workspaceId,workspaceRole:x.workspaceRole,desktopDeviceId:x.desktopDeviceId,challenge:x.challenge,challengeExpiresAt:x.challengeExpiresAt,capabilities:x.capabilities};},\n    onUploadReady:")
Path(p).write_text(text)

# relay: preserve pairing challenge/workspace headers end-to-end.
p='relay/src/server.ts'; text=Path(p).read_text()
text=text.replace("  pairToken: string;\n  deviceId: string;", "  pairToken: string;\n  pairingChallenge: string;\n  workspaceId: string;\n  deviceId: string;")
text=text.replace("        pairToken: clean(String(req.headers['x-photosync-pair-token'] || '')),\n        deviceId:", "        pairToken: clean(String(req.headers['x-photosync-pair-token'] || '')),\n        pairingChallenge: clean(String(req.headers['x-photosync-pairing-challenge'] || '')),\n        workspaceId: clean(String(req.headers['x-photosync-workspace-id'] || '')),\n        deviceId:")
text=text.replace("        'x-photosync-pair-token': encodeURIComponent(item.pairToken),\n        'x-photosync-device-id':", "        'x-photosync-pair-token': encodeURIComponent(item.pairToken),\n        'x-photosync-pairing-challenge': encodeURIComponent(item.pairingChallenge),\n        'x-photosync-workspace-id': encodeURIComponent(item.workspaceId),\n        'x-photosync-device-id':")
Path(p).write_text(text)

# mobile pairing: support v2 and persist workspace context in SecureStore.
p='mobile/src/sync/pairing.ts'; text=Path(p).read_text()
text=text.replace("  v: 1;", "  v: 1|2;")
text=text.replace("  pairCode?: string;\n};", "  pairCode?: string;\n  workspaceId?: string;\n  workspaceRole?: 'owner'|'admin'|'member'|'viewer';\n  desktopDeviceId?: string;\n  pairingChallenge?: string;\n  challengeExpiresAt?: number;\n  capabilities?: string[];\n};")
text=text.replace("  if (parsed?.v !== 1 || !parsed?.relayUrl || !parsed?.desktopId || !parsed?.pairToken) throw new Error('QR PhotoSync không hợp lệ');", "  if (![1,2].includes(parsed?.v) || !parsed?.relayUrl || !parsed?.desktopId || !parsed?.pairToken) throw new Error('QR PhotoSync không hợp lệ');\n  if (parsed.v===2 && (!parsed.workspaceId || !parsed.pairingChallenge || !Number.isFinite(Number(parsed.challengeExpiresAt)))) throw new Error('QR PhotoSync v2 thiếu workspace challenge');")
text=text.replace("    pairCode,\n  };", "    pairCode,\n    workspaceId: parsed.workspaceId ? String(parsed.workspaceId) : undefined,\n    workspaceRole: parsed.workspaceRole,\n    desktopDeviceId: parsed.desktopDeviceId ? String(parsed.desktopDeviceId) : undefined,\n    pairingChallenge: parsed.pairingChallenge ? String(parsed.pairingChallenge) : undefined,\n    challengeExpiresAt: parsed.challengeExpiresAt ? Number(parsed.challengeExpiresAt) : undefined,\n    capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities.map(String) : undefined,\n  };")
Path(p).write_text(text)

# mobile sync: use challenge for modern LAN/public and send challenge/workspace through relay.
p='mobile/src/sync/mobileSync.ts'; text=Path(p).read_text()
anchor="function publicEndpoint(target: PairedDesktop, path: string) {\n"
idx=text.index(anchor)
helper="function workspaceAuthHeaders(target: PairedDesktop): Record<string,string> {\n  if (target.pairingChallenge && target.workspaceId && (!target.challengeExpiresAt || target.challengeExpiresAt > Date.now())) return { 'x-photosync-pairing-challenge': target.pairingChallenge, 'x-photosync-workspace-id': target.workspaceId };\n  return target.pairCode ? { 'x-photosync-pair-code': target.pairCode } : {};\n}\n\n"
text=text[:idx]+helper+text[idx:]
text=text.replace("  if (!endpoint || !target.pairCode) return [];\n  const response = await fetchWithTimeout(endpoint, { headers: { 'x-photosync-pair-code': target.pairCode } }, 15_000);", "  if (!endpoint) return [];\n  const auth=workspaceAuthHeaders(target); if (!Object.keys(auth).length) return [];\n  const response = await fetchWithTimeout(endpoint, { headers: auth }, 15_000);")
text=text.replace("      requestHeaders: { 'x-photosync-pair-code': target.pairCode! },", "      requestHeaders: workspaceAuthHeaders(target),")
text=text.replace("  if (publicUrl && target.pairCode) {\n    try {\n      const response = await fetchWithTimeout(publicUrl, { headers: { 'x-photosync-pair-code': target.pairCode } }, 8_000, signal);", "  if (publicUrl && Object.keys(workspaceAuthHeaders(target)).length) {\n    try {\n      const response = await fetchWithTimeout(publicUrl, { headers: workspaceAuthHeaders(target) }, 8_000, signal);")
text=text.replace("  if (target.receiverUrl && target.pairCode) {\n    try {\n      const response = await fetchWithTimeout(localEndpoint(target, '/api/v1/status'), {\n        headers: { 'x-photosync-pair-code': target.pairCode },", "  if (target.receiverUrl && Object.keys(workspaceAuthHeaders(target)).length) {\n    try {\n      const response = await fetchWithTimeout(localEndpoint(target, '/api/v1/status'), {\n        headers: workspaceAuthHeaders(target),")
text=text.replace("            ...(transport !== 'relay'\n              ? { 'x-photosync-pair-code': target.pairCode! }\n              : { 'x-photosync-pair-token': target.pairToken }),", "            ...(transport !== 'relay'\n              ? workspaceAuthHeaders(target)\n              : { 'x-photosync-pair-token': target.pairToken, ...(target.pairingChallenge ? { 'x-photosync-pairing-challenge': target.pairingChallenge } : {}), ...(target.workspaceId ? { 'x-photosync-workspace-id': target.workspaceId } : {}) }),")
Path(p).write_text(text)

# main receiver: accept valid workspace challenge as modern auth while preserving legacy pair code fallback.
p='desktop/electron/main.ts'; text=Path(p).read_text()
text=text.replace("import { PhotoXWebEdgeServer, webEdgeConfigFromEnv } from './webEdgeServer.js';", "import { PhotoXWebEdgeServer, webEdgeConfigFromEnv } from './webEdgeServer.js';\nimport { WorkspacePairingChallengeManager } from './pairingChallenge.js';")
text=text.replace("const LEGACY_DESKTOP_DEVICE_ID=`desktop_${crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0,20)}`;", "const LEGACY_DESKTOP_DEVICE_ID=`desktop_${crypto.createHash('sha256').update(os.hostname()).digest('hex').slice(0,20)}`;\nconst workspacePairingChallenges=new WorkspacePairingChallengeManager(LEGACY_WORKSPACE_ID,LEGACY_DESKTOP_DEVICE_ID,'owner');")
old="    const url=new URL(req.url||'/','http://localhost'); const pair=await ensurePairCode();\n    if(req.headers['x-photosync-pair-code']!==pair){res.writeHead(401);res.end('Invalid pair code');return;}"
new="    const url=new URL(req.url||'/','http://localhost'); const pair=await ensurePairCode();\n    const challenge=String(req.headers['x-photosync-pairing-challenge']||''); const requestWorkspace=String(req.headers['x-photosync-workspace-id']||'');\n    const legacyPairValid=req.headers['x-photosync-pair-code']===pair; const workspaceChallengeValid=workspacePairingChallenges.verify({challenge,workspaceId:requestWorkspace});\n    if(!legacyPairValid&&!workspaceChallengeValid){res.writeHead(401);res.end('Invalid or expired pairing credential');return;}"
if old not in text: raise SystemExit('main receiver auth pattern missing')
text=text.replace(old,new,1)
Path(p).write_text(text)

# monthly ingress: make period rollover authoritative.
p='packages/persistence-sqlite/src/workspace.ts'; text=Path(p).read_text()
text=text.replace("        monthly_ingress_bytes INTEGER NOT NULL DEFAULT 0,", "        monthly_ingress_bytes INTEGER NOT NULL DEFAULT 0,\n        monthly_ingress_period TEXT,")
# backward migration column if old db exists
needle="    `);\n  }\n\n  ensureLegacyPersonalWorkspace"
insert="    `);\n    const cols=this.store.db.prepare('PRAGMA table_info(photox_workspace_usage)').all() as Array<{name:string}>;\n    if(!cols.some(col=>col.name==='monthly_ingress_period')) this.store.db.exec('ALTER TABLE photox_workspace_usage ADD COLUMN monthly_ingress_period TEXT');\n  }\n\n  private usagePeriod(now=Date.now()){const d=new Date(now);return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}\n\n  ensureMonthlyIngressPeriod(workspaceId:string, now=Date.now()): WorkspaceUsage {\n    const period=this.usagePeriod(now); const row=this.store.db.prepare('SELECT monthly_ingress_period FROM photox_workspace_usage WHERE workspace_id=?').get(workspaceId) as {monthly_ingress_period?:string}|undefined;\n    if(row?.monthly_ingress_period===period) return this.getUsage(workspaceId);\n    const usage=this.getUsage(workspaceId); const next={...usage,monthlyIngressBytes:0}; this.setUsage(workspaceId,next,now);\n    this.store.db.prepare('UPDATE photox_workspace_usage SET monthly_ingress_period=? WHERE workspace_id=?').run(period,workspaceId); return next;\n  }\n\n  ensureLegacyPersonalWorkspace"
if needle not in text: raise SystemExit('workspace migrate insertion missing')
text=text.replace(needle,insert,1)
text=text.replace("      const usage = this.getUsage(workspaceId);\n      const nextManaged", "      const usage = this.ensureMonthlyIngressPeriod(workspaceId);\n      const nextManaged",1)
Path(p).write_text(text)

# tests for monthly rollover.
p='packages/persistence-sqlite/src/workspace.test.ts'; text=Path(p).read_text()
insert="\n  it('resets monthly ingress at UTC month boundary without reducing managed storage', () => {\n    const repo = new SqliteWorkspaceRepository(store);\n    repo.ensureLegacyPersonalWorkspace({ workspaceId:'month-ws', ownerUserId:'owner', now:Date.UTC(2026,7,20) });\n    repo.reserveMediaWrite('month-ws', 100, { maxManagedStorageBytes:null, maxMonthlyIngressBytes:1000 });\n    const before=repo.getUsage('month-ws'); expect(before.managedStorageBytes).toBe(100); expect(before.monthlyIngressBytes).toBe(100);\n    const after=repo.ensureMonthlyIngressPeriod('month-ws', Date.UTC(2026,8,1));\n    expect(after.managedStorageBytes).toBe(100); expect(after.monthlyIngressBytes).toBe(0);\n  });\n"
pos=text.rfind('\n});')
if pos<0: raise SystemExit('workspace test suite end missing')
text=text[:pos]+insert+text[pos:]
Path(p).write_text(text)

print('patched workspace pairing v2 + monthly usage rollover')
