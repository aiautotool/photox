from pathlib import Path


def replace(path, old, new):
    p=Path(path); s=p.read_text()
    if old not in s: raise SystemExit(f'anchor missing in {path}: {old[:100]}')
    p.write_text(s.replace(old,new,1))

# mobile: import session helpers and use bearer after refresh
replace('mobile/src/sync/mobileSync.ts',
"import type { PairedDesktop } from './pairing';",
"import type { PairedDesktop } from './pairing';\nimport { accessHeaders, ensureWorkspaceAccess } from './pairing';")
replace('mobile/src/sync/mobileSync.ts',
"function workspaceAuthHeaders(target: PairedDesktop): Record<string,string> {\n  if (target.pairingChallenge && target.workspaceId && (!target.challengeExpiresAt || target.challengeExpiresAt > Date.now())) return { 'x-photosync-pairing-challenge': target.pairingChallenge, 'x-photosync-workspace-id': target.workspaceId };\n  return target.pairCode ? { 'x-photosync-pair-code': target.pairCode } : {};\n}",
"function workspaceAuthHeaders(target: PairedDesktop): Record<string,string> { return accessHeaders(target); }")
replace('mobile/src/sync/mobileSync.ts',
"export async function loadCloudPhotos(target: PairedDesktop): Promise<DisplayAsset[]> {\n  const endpoint = publicEndpoint(target, '/api/v1/library');",
"export async function loadCloudPhotos(target: PairedDesktop): Promise<DisplayAsset[]> {\n  await ensureWorkspaceAccess(target);\n  const endpoint = publicEndpoint(target, '/api/v1/library');")
replace('mobile/src/sync/mobileSync.ts',
"export async function pingLaptop(target: PairedDesktop, signal?:AbortSignal) {\n  const publicUrl = publicEndpoint(target, '/api/v1/status');",
"export async function pingLaptop(target: PairedDesktop, signal?:AbortSignal) {\n  await ensureWorkspaceAccess(target);\n  const publicUrl = publicEndpoint(target, '/api/v1/status');")
replace('mobile/src/sync/mobileSync.ts',
"            ...(transport !== 'relay'\n              ? workspaceAuthHeaders(target)\n              : { 'x-photosync-pair-token': target.pairToken, ...(target.pairingChallenge ? { 'x-photosync-pairing-challenge': target.pairingChallenge } : {}), ...(target.workspaceId ? { 'x-photosync-workspace-id': target.workspaceId } : {}) }),",
"            ...(transport !== 'relay'\n              ? workspaceAuthHeaders(target)\n              : { 'x-photosync-pair-token': target.pairToken, ...workspaceAuthHeaders(target) }),")

# relay carries bearer token to desktop pending download
p=Path('relay/src/server.ts'); s=p.read_text()
s=s.replace("pairingChallenge: string;\n  workspaceId: string;", "pairingChallenge: string;\n  workspaceId: string;\n  authorization: string;",1)
s=s.replace("workspaceId: clean(String(req.headers['x-photosync-workspace-id'] || '')),\n        deviceId:", "workspaceId: clean(String(req.headers['x-photosync-workspace-id'] || '')),\n        authorization: clean(String(req.headers['authorization'] || '')),\n        deviceId:",1)
s=s.replace("'x-photosync-workspace-id': encodeURIComponent(item.workspaceId),\n        'x-photosync-device-id':", "'x-photosync-workspace-id': encodeURIComponent(item.workspaceId),\n        ...(item.authorization ? { authorization: item.authorization } : {}),\n        'x-photosync-device-id':",1)
p.write_text(s)

# desktop main imports auth, holds service, exposes auth endpoints and accepts bearer
replace('desktop/electron/main.ts',
"import { getWorkspacePairingChallengeManager } from './pairingChallenge.js';",
"import { getWorkspacePairingChallengeManager } from './pairingChallenge.js';\nimport { DesktopWorkspaceAuth } from './workspaceAuth.js';")
replace('desktop/electron/main.ts',
"let webEdgeServer:PhotoXWebEdgeServer|null=null;",
"let webEdgeServer:PhotoXWebEdgeServer|null=null;\nlet workspaceAuth:DesktopWorkspaceAuth|null=null;")
replace('desktop/electron/main.ts',
"function migrationDbFile(){ return path.join(stateDir(),'migration.sqlite'); }",
"function migrationDbFile(){ return path.join(stateDir(),'migration.sqlite'); }\nfunction authSecretFile(){ return path.join(stateDir(),'workspace-auth-secret.bin'); }\nfunction requireWorkspaceAuth(){if(!workspaceAuth)throw new Error('WORKSPACE_AUTH_NOT_READY');return workspaceAuth;}")
replace('desktop/electron/main.ts',
"async function receiveMedia(req:IncomingMessage,res:ServerResponse){\n  const pair=await ensurePairCode(); if(req.headers['x-photosync-pair-code']!==pair){res.writeHead(401);res.end('Invalid pair code');return;}\n  const deviceId=String(req.headers['x-photosync-device-id']||'unknown');",
"async function receiveMedia(req:IncomingMessage,res:ServerResponse){\n  const pair=await ensurePairCode();\n  const bearer=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ');\n  if(bearer){await requireWorkspaceAuth().authorizeRequest(req,['media:write']);}\n  else if(req.headers['x-photosync-pair-code']!==pair&&!workspacePairingChallenges.verify({challenge:String(req.headers['x-photosync-pairing-challenge']||''),workspaceId:String(req.headers['x-photosync-workspace-id']||'')})){res.writeHead(401);res.end('Invalid media credential');return;}\n  const deviceId=String(req.headers['x-photosync-device-id']||'unknown');")
old="""    const url=new URL(req.url||'/','http://localhost'); const pair=await ensurePairCode();
    const challenge=String(req.headers['x-photosync-pairing-challenge']||''); const requestWorkspace=String(req.headers['x-photosync-workspace-id']||'');
    const legacyPairValid=req.headers['x-photosync-pair-code']===pair; const workspaceChallengeValid=workspacePairingChallenges.verify({challenge,workspaceId:requestWorkspace});
    if(!legacyPairValid&&!workspaceChallengeValid){res.writeHead(401);res.end('Invalid or expired pairing credential');return;}
    if(req.method==='GET'&&url.pathname==='/api/v1/status')"""
new="""    const url=new URL(req.url||'/','http://localhost'); const pair=await ensurePairCode();
    if(req.method==='POST'&&url.pathname==='/api/v1/auth/pair'){
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      try{const session=await requireWorkspaceAuth().exchange({workspaceId:String(body.workspaceId||''),pairingChallenge:String(body.pairingChallenge||''),deviceId:String(body.deviceId||''),deviceName:body.deviceName?String(body.deviceName):undefined,platform:body.platform});res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(session));}catch(error){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}return;
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/auth/refresh'){
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
      try{const session=await requireWorkspaceAuth().refresh(String(body.refreshToken||''));res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(session));}catch(error){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}return;
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/auth/revoke'){
      try{await requireWorkspaceAuth().authorizeRequest(req,['media:read']);const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');await requireWorkspaceAuth().revoke(String(body.sessionId||''));res.writeHead(204);res.end();}catch(error){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:error instanceof Error?error.message:String(error)}));}return;
    }
    const challenge=String(req.headers['x-photosync-pairing-challenge']||''); const requestWorkspace=String(req.headers['x-photosync-workspace-id']||'');
    const legacyPairValid=req.headers['x-photosync-pair-code']===pair; const workspaceChallengeValid=workspacePairingChallenges.verify({challenge,workspaceId:requestWorkspace});
    const bearer=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ');
    if(bearer){const scope=url.pathname==='/api/v1/media'&&req.method==='POST'?'media:write':req.method==='DELETE'?'media:delete':url.pathname.startsWith('/api/v1/media/')||url.pathname.startsWith('/api/v1/playback/')||url.pathname.startsWith('/api/v1/thumbnail/')?'media:download':'media:read';try{await requireWorkspaceAuth().authorizeRequest(req,[scope]);}catch(error){res.writeHead(401);res.end(error instanceof Error?error.message:String(error));return;}}
    else if(!legacyPairValid&&!workspaceChallengeValid){res.writeHead(401);res.end('Invalid or expired pairing credential');return;}
    if(req.method==='GET'&&url.pathname==='/api/v1/status')"""
replace('desktop/electron/main.ts',old,new)
replace('desktop/electron/main.ts',
"migrationStore=new SqlitePhotoXStore({path:migrationDbFile()});workspaceRepository=new SqliteWorkspaceRepository(migrationStore);await bootstrapLegacyWorkspace();migrationService=",
"migrationStore=new SqlitePhotoXStore({path:migrationDbFile()});workspaceRepository=new SqliteWorkspaceRepository(migrationStore);await bootstrapLegacyWorkspace();workspaceAuth=await DesktopWorkspaceAuth.create({secretFile:authSecretFile(),store:migrationStore,workspaces:workspaceRepository,pairing:workspacePairingChallenges,workspaceId:LEGACY_WORKSPACE_ID,ownerUserId:LEGACY_OWNER_USER_ID});migrationService=")
replace('desktop/electron/main.ts',
"migrationStore?.close();migrationStore=null;workspaceRepository=null;migrationService=null});",
"migrationStore?.close();migrationStore=null;workspaceRepository=null;workspaceAuth=null;migrationService=null});")

print('v4 session patch applied')
