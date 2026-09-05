import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { PhotoXWebEdgeServer, type WebEdgeHandlers, type WebPrincipal } from './webEdgeServer.js';

async function freePort(){
  const server=net.createServer();
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address==='object');const port=address.port;
  await new Promise<void>(resolve=>server.close(()=>resolve()));return port;
}

function baseHandlers(authorize:(token:string)=>WebPrincipal, repair:(principal:WebPrincipal,key:string)=>Promise<unknown>):WebEdgeHandlers{
  return {
    authorizeAccessToken:async(token,required)=>{assert.deepEqual(required,['media:read']);return authorize(token);},
    createWebSession:async()=>({accessToken:'unused',refreshToken:'unused',accessExpiresAt:Date.now()+60_000,sessionId:'unused'}),
    refreshSession:async()=>({accessToken:'unused',accessExpiresAt:Date.now()+60_000,sessionId:'unused'}),
    revokeSession:async()=>undefined,
    repairMedia:repair,
    appendAudit:async()=>undefined,
    getStatus:async()=>({}),getTunnelStatus:async()=>({}),listLocalMedia:async()=>[],listCloudUploads:async()=>[],getBackupHealth:async()=>({}),openLibrary:async()=>({}),
    addGoogleAccount:async()=>({}),listGoogleAccounts:async()=>[],removeGoogleAccount:async()=>({}),retryCloud:async()=>({}),
    listGooglePhotosAccounts:async()=>[],connectGooglePhotosAccount:async()=>({}),removeGooglePhotosAccount:async()=>({}),
    listMigrations:async()=>[],getMigration:async()=>({}),createMigration:async()=>({}),materializeMigration:async()=>({}),runMigration:async()=>({}),pauseMigration:async()=>({}),resumeMigration:async()=>({}),cancelMigration:async()=>({}),retryMigration:async()=>({}),
    streamMedia:async(_req,res)=>{res.writeHead(404);res.end();},
  };
}

const principal=(workspaceId:string,workspaceRole:'member'|'viewer'):WebPrincipal=>({subject:`user-${workspaceId}`,workspaceId,workspaceRole,sessionId:`session-${workspaceId}`,scopes:['media:read']});

test('Web exact-media repair is principal-scoped, CSRF protected, member-only and preserves encoded media identity',async()=>{
  const staticDir=await fs.mkdtemp(path.join(os.tmpdir(),'photox-web-repair-'));await fs.writeFile(path.join(staticDir,'index.html'),'ok');
  const port=await freePort();const origin=`http://127.0.0.1:${port}`;const calls:Array<{workspaceId:string;key:string}>=[];
  const edge=new PhotoXWebEdgeServer({enabled:true,host:'127.0.0.1',port,allowedOrigins:[origin],staticDir,publicBaseUrl:origin,rateLimitPerMinute:300},baseHandlers(
    token=>token==='member-b'?principal('workspace-b','member'):token==='viewer'?principal('workspace-a','viewer'):principal('workspace-a','member'),
    async(actor,key)=>{calls.push({workspaceId:actor.workspaceId,key});return {workspaceId:actor.workspaceId,key,status:'queued',verifiedReplicas:1,targetReplicas:2};},
  ));
  const headers=(token:string,csrf=true)=>({origin,authorization:`Bearer ${token}`,...(csrf?{cookie:'photox_csrf=csrf-token','x-csrf-token':'csrf-token'}:{})});
  try{
    await edge.start();
    const key='folder/a b.jpg';
    const ok=await fetch(`${origin}/api/web/v1/media/${encodeURIComponent(key)}/repair`,{method:'POST',headers:headers('member-a')});
    assert.equal(ok.status,200);assert.deepEqual(calls,[{workspaceId:'workspace-a',key}]);
    assert.equal((await ok.json() as any).workspaceId,'workspace-a');

    const crossTenant=await fetch(`${origin}/api/web/v1/media/${encodeURIComponent(key)}/repair`,{method:'POST',headers:headers('member-b')});
    assert.equal(crossTenant.status,200);assert.deepEqual(calls[1],{workspaceId:'workspace-b',key});

    const noCsrf=await fetch(`${origin}/api/web/v1/media/${encodeURIComponent('asset-c')}/repair`,{method:'POST',headers:headers('member-a',false)});
    assert.equal(noCsrf.status,403);assert.equal(calls.length,2);

    const viewer=await fetch(`${origin}/api/web/v1/media/${encodeURIComponent('asset-d')}/repair`,{method:'POST',headers:headers('viewer')});
    assert.equal(viewer.status,403);assert.equal(calls.length,2);
  } finally {await edge.stop();await fs.rm(staticDir,{recursive:true,force:true});}
});
