import { readFile, writeFile } from 'node:fs/promises';

const mainPath='desktop/electron/main.ts';
let source=await readFile(mainPath,'utf8');

const importNeedle="import { createMediaProviderOperationGate } from './mediaProviderOperationGate.js';";
if(!source.includes("createMediaIngestCommitCoordinator")){
  if(!source.includes(importNeedle))throw new Error('provider gate import anchor missing');
  source=source.replace(importNeedle,`${importNeedle}\nimport { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';`);
}

const gateNeedle='const mediaProviderOperationGate=createMediaProviderOperationGate();';
if(!source.includes('const mediaIngestCommitCoordinator=createMediaIngestCommitCoordinator();')){
  if(!source.includes(gateNeedle))throw new Error('provider gate constant anchor missing');
  source=source.replace(gateNeedle,`${gateNeedle}\nconst mediaIngestCommitCoordinator=createMediaIngestCommitCoordinator();`);
}

const start=source.indexOf('async function receiveMedia(req:IncomingMessage,res:ServerResponse){');
const end=source.indexOf('\n\nasync function desktopStatus()',start);
if(start<0||end<0)throw new Error('receiveMedia block not found');

const replacement=`async function receiveMedia(req:IncomingMessage,res:ServerResponse){
  const pair=await ensurePairCode();
  const bearer=typeof req.headers.authorization==='string'&&req.headers.authorization.startsWith('Bearer ');
  let requestWorkspace=LEGACY_WORKSPACE_ID;
  if(bearer){const principal=await requireWorkspaceAuth().authorizeRequest(req,['media:write']);requestWorkspace=principal.workspaceId!;}
  else {const headerWorkspace=String(req.headers['x-photosync-workspace-id']||'');if(req.headers['x-photosync-pair-code']!==pair&&!workspacePairingChallenges.verify({challenge:String(req.headers['x-photosync-pairing-challenge']||''),workspaceId:headerWorkspace})){res.writeHead(401);res.end('Invalid media credential');return;}if(headerWorkspace)requestWorkspace=headerWorkspace;}
  const deviceId=String(req.headers['x-photosync-device-id']||'unknown'); const assetId=String(req.headers['x-photosync-asset-id']||''); const key=\`\${deviceId}:\${assetId}\`;
  const rows=await readIndex(requestWorkspace); if(rows.some(x=>x.key===key)){lastStatus.duplicates+=1;res.writeHead(208,{'content-type':'application/json'});res.end(JSON.stringify({state:'ALREADY_RECEIVED'}));return;}
  const filename=safeFilename(decodeURIComponent(String(req.headers['x-photosync-filename']||\`media-\${Date.now()}\`))); const createdAt=Number(req.headers['x-photosync-created-at']||Date.now());
  const declaredSize=Number(req.headers['x-photosync-size']||req.headers['content-length']||0);
  if(!Number.isFinite(declaredSize)||declaredSize<=0){res.writeHead(411,{'content-type':'application/json'});res.end(JSON.stringify({error:'MEDIA_SIZE_REQUIRED'}));return;}
  const repo=requireWorkspaceRepository();const workspace=repo.getWorkspace(requestWorkspace);if(!workspace){res.writeHead(503);res.end('Workspace unavailable');return;}
  const entitlements=entitlementsForPlan(workspace.plan);
  try{repo.reserveMediaWrite(requestWorkspace,declaredSize,{maxManagedStorageBytes:entitlements.maxManagedStorageBytes,maxMonthlyIngressBytes:entitlements.maxMonthlyIngressBytes});}
  catch(error){const message=error instanceof Error?error.message:String(error);res.writeHead(413,{'content-type':'application/json'});res.end(JSON.stringify({error:message}));return;}
  let reservationCommitted=false;
  const declaredMediaType=String(req.headers['x-photosync-media-type']||'photo')==='video'?'video':'photo';
  const declaredMime=String(req.headers['content-type']||'').split(';')[0].trim();const mimeType=declaredMime&&declaredMime!=='application/octet-stream'?declaredMime:mimeTypeForFilename(filename);
  const date=new Date(Number.isFinite(createdAt)?createdAt:Date.now()); const folder=path.join(libraryDir(),String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'));
  await fs.mkdir(incomingDir(),{recursive:true});await fs.mkdir(folder,{recursive:true}); const tmp=path.join(incomingDir(),\`\${crypto.randomUUID()}.part\`);
  try{
    await pipeline(req,createWriteStream(tmp));
    const stat=await fs.stat(tmp);
    if(stat.size!==declaredSize)throw new Error(\`MEDIA_SIZE_MISMATCH:\${declaredSize}:\${stat.size}\`);
    const hash=await hashFile(tmp);
    let outcome;
    try{
      outcome=await mediaIngestCommitCoordinator.run({workspaceId:requestWorkspace,key},{
        exists:async()=>{const authoritative=await readIndex(requestWorkspace);return authoritative.some(item=>item.key===key);},
        commit:async()=>{
          const parsed=path.parse(filename);
          const uniqueSuffix=crypto.createHash('sha256').update(\`\${requestWorkspace}\\0\${key}\\0\${crypto.randomUUID()}\`).digest('hex').slice(0,16);
          const target=path.join(folder,\`\${parsed.name}-\${uniqueSuffix}\${parsed.ext}\`);
          await fs.rename(tmp,target);
          const row:MediaIndexRow={workspaceId:requestWorkspace,key,assetId,deviceId,filename,path:target,size:stat.size,createdAt,receivedAt:new Date().toISOString(),sha256:hash,mimeType,mediaType:declaredMediaType,videoProcessing:declaredMediaType==='video'?'queued':undefined,cloudReplicas:[]};
          try{await mediaIndexWriter().ingest(row);return {row,target};}
          catch(error){await fs.unlink(target).catch(()=>undefined);throw error;}
        },
      });
    }catch(error){
      if(error instanceof Error&&error.message==='MEDIA_INDEX_DUPLICATE_KEY'){
        await fs.unlink(tmp).catch(()=>undefined);repo.releaseMediaReservation(requestWorkspace,declaredSize);lastStatus.duplicates+=1;
        res.writeHead(208,{'content-type':'application/json'});res.end(JSON.stringify({state:'ALREADY_RECEIVED'}));return;
      }
      throw error;
    }
    if(outcome.status==='duplicate'){
      await fs.unlink(tmp).catch(()=>undefined);repo.releaseMediaReservation(requestWorkspace,declaredSize);lastStatus.duplicates+=1;
      res.writeHead(208,{'content-type':'application/json'});res.end(JSON.stringify({state:'ALREADY_RECEIVED'}));return;
    }
    const {row,target}=outcome.value;
    lastStatus={...lastStatus,state:'idle',received:lastStatus.received+1,message:\`Đã nhận \${filename}\`,lastRunAt:new Date().toISOString()}; notifyRenderer('photosync:file-received',{name:filename,path:target});
    res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({state:'LOCAL_STORED',sha256:hash,path:target,processing:row.videoProcessing}));
    reservationCommitted=true;
    repo.appendAudit({workspaceId:requestWorkspace,actorUserId:LEGACY_OWNER_USER_ID,actorDeviceId:deviceId,action:'media.ingest',targetType:'media',targetId:key,metadata:{filename,size:stat.size}});
    if(declaredMediaType==='video')void processVideoRow(key,requestWorkspace);void enqueueCloudUpload(row);
  }catch(error){
    await fs.unlink(tmp).catch(()=>undefined);
    if(!reservationCommitted)repo.releaseMediaReservation(requestWorkspace,declaredSize);
    throw error;
  }
}`;

source=source.slice(0,start)+replacement+source.slice(end);
await writeFile(mainPath,source,'utf8');
console.log('receiveMedia wired through exact ingest coordinator');
