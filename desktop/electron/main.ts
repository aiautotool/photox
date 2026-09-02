import 'dotenv/config';
import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { OAuth2Client } from 'google-auth-library';
import { chooseAccount, evaluateBackupHealth, DEFAULT_PHOTO_POLICY, DEFAULT_VIDEO_POLICY, type MediaReplica, type StorageAccount } from '@photosync/core';
import { DRIVE_SCOPE, createResumableUploadSession, ensurePhotoSyncFolder, getStorageQuota, listPhotoSyncFiles } from '@photosync/google-drive';
import { isVideoFilename, mimeTypeForFilename, processVideoFile } from './mediaProcessing.js';

protocol.registerSchemesAsPrivileged([{ scheme: 'photosync', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECEIVER_PORT = 43117;
const OAUTH_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}/oauth2callback`;
const PUBLIC_TUNNEL_URL = process.env.PHOTOSYNC_PUBLIC_URL || 'https://photox.aiautotool.com';
let mainWindow: BrowserWindow | null = null;
let receiver: http.Server | null = null;
let cloudflaredProcess: ChildProcess | null = null;
let cloudflareMonitor: NodeJS.Timeout | null = null;
let cloudflareRestart: NodeJS.Timeout | null = null;
let cloudflareStopping = false;
let lastStatus: DesktopStatus = { state: 'idle', received: 0, duplicates: 0, cloudUploaded: 0, cloudBlocked: 0 };
let cloudUploadQueue: Promise<void> = Promise.resolve();
let repairSweepActive=false;
let repairSweepTimer:NodeJS.Timeout|null=null;

function notifyRenderer(channel:string,payload:unknown){
  const win=mainWindow;
  if(!win||win.isDestroyed()||win.webContents.isDestroyed())return;
  win.webContents.send(channel,payload);
}

type DesktopStatus = {
  state: 'idle'|'receiving'|'uploading'|'error';
  received: number;
  duplicates: number;
  cloudUploaded: number;
  cloudBlocked: number;
  message?: string;
  receiverUrl?: string;
  pairCode?: string;
  publicUrl?: string;
  tunnelHealthy?: boolean;
  libraryPath?: string;
  driveAccounts?: number;
  lastRunAt?: string;
};

const TARGET_CLOUD_REPLICAS=2;
type LocalMedia = { key:string;name:string;path:string;url:string;modifiedAt:string;sourceDevice?:string;size:number;receivedAt:string;sha256:string;localAvailable:boolean;cloudAvailable:boolean };
type CloudState = 'QUEUED'|'UPLOADING'|'VERIFYING'|'VERIFIED'|'UPLOADED'|'BLOCKED'|'ERROR';
type CloudDestination = { state:CloudState;accountId?:string;accountEmail?:string;folderId?:string;remotePath?:string;remoteFileId?:string;webViewLink?:string;uploadedAt?:string;verifiedAt?:string;message?:string };
type VideoProcessingState = 'queued'|'processing'|'ready'|'error';
type MediaIndexRow = {
  key:string;
  assetId:string;
  deviceId:string;
  filename:string;
  path:string;
  size:number;
  createdAt:number;
  receivedAt:string;
  sha256:string;
  mimeType?:string;
  mediaType?:'photo'|'video';
  width?:number;
  height?:number;
  duration?:number;
  rotation?:number;
  fps?:number;
  bitrate?:number;
  container?:string;
  videoCodec?:string;
  audioCodec?:string;
  hasAudio?:boolean;
  thumbnailPath?:string;
  playbackPath?:string;
  videoProcessing?:VideoProcessingState;
  videoError?:string;
  cloud?:CloudDestination;
  cloudReplicas?:CloudDestination[];
};
type SavedDriveAccount = { id:string; email?:string; tokens:any };
type RuntimeDriveAccount = { id:string; email:string; client:OAuth2Client; storage:StorageAccount; folderId:string; quota:{limit:number;usage:number;free:number} };
type DriveAccountInfo = { id:string;email:string;usedBytes:number;freeBytes:number;totalBytes:number;status:'ready'|'unavailable' };
type CloudUploadItem = { key:string;filename:string;size:number;receivedAt:string;deviceId:string;state:CloudState;accountId?:string;accountEmail?:string;folderId?:string;remotePath?:string;remoteFileId?:string;webViewLink?:string;uploadedAt?:string;verifiedAt?:string;message?:string };
type BackupHealthSnapshot = {
  total:number;
  safe:number;
  atRisk:number;
  critical:number;
  unknown:number;
  photos:number;
  videos:number;
  totalBytes:number;
  problems:{key:string;filename:string;health:'at_risk'|'critical'|'unknown';reason:string}[];
};

function tokenIdentity(tokens:any):{email?:string;sub?:string}{
  try{
    const payload=JSON.parse(Buffer.from(String(tokens?.id_token||'').split('.')[1]||'','base64url').toString('utf8'));
    return {email:typeof payload.email==='string'?payload.email.toLowerCase():undefined,sub:typeof payload.sub==='string'?payload.sub:undefined};
  }catch{return {}}
}

function stableDriveAccountId(email?:string,sub?:string){
  const identity=(sub||email||crypto.randomUUID()).toLowerCase();
  return `drive-${crypto.createHash('sha256').update(identity).digest('hex').slice(0,20)}`;
}

function libraryDir(){ return path.join(app.getPath('pictures'),'PhotoSync'); }
function stateDir(){ return path.join(app.getPath('userData'),'photosync-state'); }
function incomingDir(){ return path.join(stateDir(),'incoming'); }
function videoCacheDir(){ return path.join(stateDir(),'video-cache'); }
function indexFile(){ return path.join(stateDir(),'media-index.json'); }
function pairFile(){ return path.join(stateDir(),'pair-code.txt'); }
function driveAccountsDir(){ return path.join(stateDir(),'google-accounts'); }

async function ensurePairCode(){
  await fs.mkdir(stateDir(),{recursive:true});
  try {
    const saved=(await fs.readFile(pairFile(),'utf8')).trim();
    if(saved&&!/^\d{6}$/.test(saved))return saved;
  }catch{}
  const code=crypto.randomBytes(32).toString('base64url');
  await fs.writeFile(pairFile(),code,{encoding:'utf8',mode:0o600});
  return code;
}

function lanAddress(){
  for(const entries of Object.values(os.networkInterfaces())) for(const item of entries||[]) if(item.family==='IPv4'&&!item.internal) return item.address;
  return '127.0.0.1';
}

async function readIndex():Promise<MediaIndexRow[]>{ try{return JSON.parse(await fs.readFile(indexFile(),'utf8'))}catch{return []} }
async function writeIndex(rows:MediaIndexRow[]){ await fs.mkdir(stateDir(),{recursive:true}); await fs.writeFile(indexFile(),JSON.stringify(rows,null,2),'utf8'); }
async function updateIndexRow(key:string,patch:Partial<MediaIndexRow>){const rows=await readIndex();const index=rows.findIndex(row=>row.key===key);if(index<0)return null;rows[index]={...rows[index],...patch};await writeIndex(rows);return rows[index]}
function replicasOf(row:MediaIndexRow){if(row.cloudReplicas?.length)return row.cloudReplicas;if(row.cloud)return [row.cloud];return []}
function isVerified(replica:CloudDestination){return replica.state==='VERIFIED'||replica.state==='UPLOADED'}
async function evaluateRow(row:MediaIndexRow){
  const replicas:MediaReplica[]=[];
  try{await fs.access(row.path);replicas.push({providerId:'local',providerType:'local',replicaType:'original',status:'available'})}catch{}
  for(const replica of replicasOf(row))replicas.push({providerId:replica.accountId||'drive',providerType:'google_drive',replicaType:'original',status:isVerified(replica)?'available':replica.state==='ERROR'?'failed':'queued',verifiedAt:replica.verifiedAt?Date.parse(replica.verifiedAt):undefined});
  return evaluateBackupHealth(replicas,isVideoFilename(row.filename)?DEFAULT_VIDEO_POLICY:DEFAULT_PHOTO_POLICY);
}
async function backupHealthSnapshot():Promise<BackupHealthSnapshot>{
  const rows=await readIndex();const snapshot:BackupHealthSnapshot={total:rows.length,safe:0,atRisk:0,critical:0,unknown:0,photos:0,videos:0,totalBytes:rows.reduce((sum,row)=>sum+row.size,0),problems:[]};
  for(const row of rows){const video=isVideoFilename(row.filename);if(video)snapshot.videos+=1;else snapshot.photos+=1;const result=await evaluateRow(row);if(result.health==='safe')snapshot.safe+=1;else if(result.health==='at_risk')snapshot.atRisk+=1;else if(result.health==='critical')snapshot.critical+=1;else snapshot.unknown+=1;if(result.health!=='safe')snapshot.problems.push({key:row.key,filename:row.filename,health:result.health,reason:result.reasons.join(',')||'verification_required'})}
  return snapshot;
}
async function persistReplicas(row:MediaIndexRow,replicas:CloudDestination[]){row.cloudReplicas=replicas;row.cloud=replicas[0];const all=await readIndex();const i=all.findIndex(x=>x.key===row.key);if(i>=0){all[i]={...all[i],cloud:row.cloud,cloudReplicas:replicas};await writeIndex(all)}notifyRenderer('photosync:storage-updated',{key:row.key,cloudReplicas:replicas})}
function safeFilename(value:string){ return value.replace(/[\\/:*?"<>|]/g,'_').replace(/^\.+/,'_').slice(0,220)||`media-${Date.now()}`; }

async function hashFile(filePath:string){
  return await new Promise<string>((resolve,reject)=>{ const hash=crypto.createHash('sha256'); const stream=createReadStream(filePath); stream.on('data',chunk=>hash.update(chunk)); stream.on('end',()=>resolve(hash.digest('hex'))); stream.on('error',reject); });
}

async function streamNodeFile(req:IncomingMessage,res:ServerResponse,filePath:string,contentType:string){
  const stat=await fs.stat(filePath);const range=req.headers.range;
  if(range){
    const match=/bytes=(\d+)-(\d*)/.exec(range);
    if(match){
      const start=Number(match[1]);const end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
      if(start>=stat.size||end<start){res.writeHead(416,{'content-range':`bytes */${stat.size}`});res.end();return;}
      res.writeHead(206,{'content-type':contentType,'content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${stat.size}`,'accept-ranges':'bytes','cache-control':'no-store'});createReadStream(filePath,{start,end}).pipe(res);return;
    }
  }
  res.writeHead(200,{'content-type':contentType,'content-length':String(stat.size),'accept-ranges':'bytes','cache-control':'no-store'});createReadStream(filePath).pipe(res);
}

async function processVideoRow(key:string){
  const row=(await readIndex()).find(item=>item.key===key);if(!row||!isVideoFilename(row.filename))return;
  await updateIndexRow(key,{videoProcessing:'processing',videoError:undefined});
  try{
    const processed=await processVideoFile(row.path,row.key,videoCacheDir());
    await updateIndexRow(key,{...processed,mediaType:'video',mimeType:row.mimeType||mimeTypeForFilename(row.filename),videoProcessing:'ready',videoError:undefined});
    notifyRenderer('photosync:media-processed',{key,...processed});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await updateIndexRow(key,{videoProcessing:'error',videoError:message});
    console.error('Video processing failed',row.filename,error);
  }
}

async function listLocalMedia():Promise<LocalMedia[]>{
  const rows=await readIndex();
  const media:LocalMedia[]=[];
  for(const row of rows){
    let localAvailable=false;
    let modifiedAt=new Date(row.createdAt||Date.parse(row.receivedAt)||0).toISOString();
    try{const stat=await fs.stat(row.path);localAvailable=true;modifiedAt=stat.mtime.toISOString()}catch{}
    const cloudAvailable=replicasOf(row).some(replica=>isVerified(replica)&&Boolean(replica.remoteFileId&&replica.accountId));
    if(localAvailable||cloudAvailable)media.push({key:row.key,name:row.filename,path:row.path,url:`photosync://media/${encodeURIComponent(row.key)}`,modifiedAt,sourceDevice:row.deviceId,size:row.size,receivedAt:row.receivedAt,sha256:row.sha256,localAvailable,cloudAvailable});
  }
  return media.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));
}

async function deleteManagedMedia(key:string){
  const rows=await readIndex();const index=rows.findIndex(row=>row.key===key);if(index<0)throw new Error('MEDIA_NOT_FOUND');const row=rows[index];
  const accounts=new Map((await savedDriveAccounts()).map(account=>[account.id,account]));const failures:string[]=[];
  for(const replica of replicasOf(row).filter(replica=>replica.remoteFileId)){
    if(!replica.accountId){failures.push('Replica thiếu accountId');continue;}
    const account=accounts.get(replica.accountId);if(!account){failures.push(`Không còn thông tin tài khoản ${replica.accountId}`);continue;}
    try{
      const client=oauthClient();client.setCredentials(account.tokens);const token=await client.getAccessToken();if(!token.token)throw new Error('Không lấy được access token');
      const response=await net.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(replica.remoteFileId!)}`,{method:'DELETE',headers:{authorization:`Bearer ${token.token}`}});
      if(!response.ok&&response.status!==404)throw new Error(`Drive ${response.status}: ${await response.text()}`);
    }catch(error){failures.push(`${replica.accountEmail||replica.accountId}: ${error instanceof Error?error.message:String(error)}`)}
  }
  if(failures.length)throw new Error(`Không xóa hết replica cloud: ${failures.join(' | ')}`);
  for(const filePath of [row.thumbnailPath,row.playbackPath,row.path])if(filePath)await fs.unlink(filePath).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error});
  rows.splice(index,1);await writeIndex(rows);notifyRenderer('photosync:media-deleted',{key,filename:row.filename});return {deleted:true,key,filename:row.filename};
}

async function fetchCloudMedia(row:MediaIndexRow,request:Request):Promise<Response>{
  const replicas=replicasOf(row).filter(replica=>isVerified(replica)&&replica.remoteFileId&&replica.accountId);
  const accounts=new Map((await savedDriveAccounts()).map(account=>[account.id,account]));
  let lastStatus=404;
  for(const replica of replicas){
    const account=accounts.get(replica.accountId!);if(!account)continue;
    try{
      const client=oauthClient();client.setCredentials(account.tokens);
      const token=await client.getAccessToken();if(!token.token)continue;
      if(JSON.stringify(client.credentials)!==JSON.stringify(account.tokens))await fs.writeFile(path.join(driveAccountsDir(),`${account.id}.json`),JSON.stringify({...account,tokens:client.credentials},null,2),'utf8');
      const headers:Record<string,string>={authorization:`Bearer ${token.token}`};
      const range=request.headers.get('range');if(range)headers.range=range;
      const response=await net.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(replica.remoteFileId!)}?alt=media`,{headers});
      lastStatus=response.status;
      if(response.ok||response.status===206)return response;
    }catch(error){console.error('Drive media fallback failed',replica.remoteFileId,error)}
  }
  return new Response('Cloud media unavailable',{status:lastStatus});
}

function oauthClient(){
  let id=process.env.PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_ID, secret=process.env.PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_SECRET;
  if(!id||!secret){
    try{
      const configPath=app.isPackaged?path.join(process.resourcesPath,'google-oauth.json'):path.join(__dirname,'../google-oauth.json');
      const config=JSON.parse(readFileSync(configPath,'utf8'));
      const installed=config.installed||config.web||{};
      id=installed.client_id; secret=installed.client_secret;
    }catch{}
  }
  if(!id||!secret) throw new Error('Thiếu Google Desktop OAuth client trong desktop/.env');
  return new OAuth2Client(id,secret,REDIRECT_URI);
}

async function savedDriveAccounts():Promise<SavedDriveAccount[]>{
  await fs.mkdir(driveAccountsDir(),{recursive:true});
  const files=(await fs.readdir(driveAccountsDir())).filter(x=>x.endsWith('.json'));
  const unique=new Map<string,SavedDriveAccount>();
  for(const file of files){try{
    const account:SavedDriveAccount=JSON.parse(await fs.readFile(path.join(driveAccountsDir(),file),'utf8'));
    const identity=tokenIdentity(account.tokens); const email=(account.email||identity.email)?.toLowerCase();
    const key=identity.sub||email||account.id;
    unique.set(key,{...account,email:email||account.email});
  }catch{}}
  return [...unique.values()];
}

async function connectGoogle(){
  const client=oauthClient();
  const url=client.generateAuthUrl({access_type:'offline',prompt:'consent select_account',include_granted_scopes:true,scope:[DRIVE_SCOPE,'https://www.googleapis.com/auth/drive.metadata.readonly','openid','email','profile']});
  await shell.openExternal(url);
  return await new Promise<DesktopStatus>((resolve,reject)=>{
    const server=http.createServer(async(req,res)=>{try{
      const incoming=new URL(req.url||'/',REDIRECT_URI); if(incoming.pathname!=='/oauth2callback')return;
      const code=incoming.searchParams.get('code'); if(!code)throw new Error('Google không trả authorization code');
      const {tokens}=await client.getToken(code);
      client.setCredentials(tokens); const profile=await client.getTokenInfo(tokens.access_token||''); const tokenData=tokenIdentity(tokens); const email=(profile.email||tokenData.email)?.toLowerCase(); const id=stableDriveAccountId(email,tokenData.sub);
      await fs.mkdir(driveAccountsDir(),{recursive:true});
      const existingFiles=(await fs.readdir(driveAccountsDir())).filter(x=>x.endsWith('.json'));
      for(const file of existingFiles)try{const saved:SavedDriveAccount=JSON.parse(await fs.readFile(path.join(driveAccountsDir(),file),'utf8'));const identity=tokenIdentity(saved.tokens);if((tokenData.sub&&identity.sub===tokenData.sub)||(email&&(saved.email||identity.email)?.toLowerCase()===email))await fs.unlink(path.join(driveAccountsDir(),file))}catch{}
      await fs.writeFile(path.join(driveAccountsDir(),`${id}.json`),JSON.stringify({id,email:email||id,tokens},null,2),'utf8');
      res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<h2>Đã thêm Google Drive vào PhotoSync Laptop.</h2><p>Bạn có thể đóng tab này.</p>');server.close();
      lastStatus={...lastStatus,message:'Đã thêm tài khoản Google Drive',driveAccounts:(await savedDriveAccounts()).length}; resolve(await desktopStatus());void retryQueuedCloud();
    }catch(e){server.close();reject(e)}}); server.listen(OAUTH_PORT,'127.0.0.1'); server.on('error',reject);
  });
}

async function runtimeDriveAccounts():Promise<RuntimeDriveAccount[]>{
  const saved=await savedDriveAccounts(); const result:RuntimeDriveAccount[]=[];
  for(const account of saved){try{
    const client=oauthClient(); client.setCredentials(account.tokens); const token=await client.getAccessToken(); if(!token.token)continue;
    if(JSON.stringify(client.credentials)!==JSON.stringify(account.tokens)) await fs.writeFile(path.join(driveAccountsDir(),`${account.id}.json`),JSON.stringify({id:account.id,tokens:client.credentials},null,2),'utf8');
    const folderId=await ensurePhotoSyncFolder(token.token); const [quota,files]=await Promise.all([getStorageQuota(token.token),listPhotoSyncFiles(token.token,folderId)]);
    const appUsedBytes=files.reduce((sum,f)=>sum+Number(f.size||0),0); const providerFreeBytes=Math.max(0,Number(quota.limit||0)-Number(quota.usage||0));
    let email=account.email;
    if(!email){try{email=(await client.getTokenInfo(token.token)).email}catch{}}
    email=email||account.id;
    if(email!==account.email)await fs.writeFile(path.join(driveAccountsDir(),`${account.id}.json`),JSON.stringify({...account,email,tokens:client.credentials},null,2),'utf8');
    result.push({id:account.id,email,client,folderId,storage:{id:account.id,email,appUsedBytes,providerFreeBytes,providerTotalBytes:Number(quota.limit||0)},quota:{limit:Number(quota.limit||0),usage:Number(quota.usage||0),free:providerFreeBytes}});
  }catch(e){console.error('Drive account unavailable',account.id,e)}}
  return result;
}

async function listDriveAccounts():Promise<DriveAccountInfo[]>{
  const saved=await savedDriveAccounts();
  const runtime=new Map((await runtimeDriveAccounts()).map(account=>[account.id,account]));
  return saved.map(account=>{
    const active=runtime.get(account.id);
    const freeBytes=active?.quota.free||0;
    const usedBytes=active?.quota.usage||0;
    const totalBytes=active?.quota.limit||usedBytes+freeBytes;
    return {id:account.id,email:active?.email||account.email||account.id,usedBytes,freeBytes,totalBytes,status:active?'ready':'unavailable'};
  });
}

async function removeDriveAccount(accountId:string){
  const account=(await savedDriveAccounts()).find(item=>item.id===accountId);
  if(!account)throw new Error('Không tìm thấy tài khoản');
  const files=(await fs.readdir(driveAccountsDir())).filter(name=>name.endsWith('.json'));
  for(const file of files)try{const saved:SavedDriveAccount=JSON.parse(await fs.readFile(path.join(driveAccountsDir(),file),'utf8'));if(saved.id===account.id)await fs.unlink(path.join(driveAccountsDir(),file))}catch{}
  notifyRenderer('photosync:storage-updated',{accountId,removed:true});
  return desktopStatus();
}

function enqueueCloudUpload(row:MediaIndexRow){
  cloudUploadQueue=cloudUploadQueue.then(()=>uploadLocalToDrive(row)).catch(error=>console.error('Drive queue failed',error));
  return cloudUploadQueue;
}

async function retryQueuedCloud(){
  if(repairSweepActive)return;
  repairSweepActive=true;
  try{const rows=await readIndex();for(const row of rows.filter(x=>new Set(replicasOf(x).filter(isVerified).map(r=>r.accountId)).size<TARGET_CLOUD_REPLICAS))await enqueueCloudUpload(row)}finally{repairSweepActive=false}
}

async function uploadLocalToDrive(row:MediaIndexRow){
  const accounts=await runtimeDriveAccounts();
  if(!accounts.length){
    const replicas=replicasOf(row).filter(isVerified);replicas.push({state:'QUEUED',message:'Đang chờ có đủ 2 tài khoản Google Drive hợp lệ; hệ thống sẽ tự thử lại.'});await persistReplicas(row,replicas);return;
  }
  const replicas=replicasOf(row).filter(r=>isVerified(r)||r.state==='ERROR');
  while(new Set(replicas.filter(isVerified).map(r=>r.accountId)).size<TARGET_CLOUD_REPLICAS){
    const used=new Set(replicas.filter(isVerified).map(r=>r.accountId));
    const eligible=accounts.filter(a=>!used.has(a.id));
    const chosenStorage=chooseAccount(eligible.map(x=>x.storage),row.size);
    if(!chosenStorage){replicas.push({state:'QUEUED',message:`Đang chờ tài khoản Drive phù hợp: hiện có ${used.size}/${TARGET_CLOUD_REPLICAS} bản hợp lệ. Hệ thống sẽ tự thử lại.`});lastStatus.cloudBlocked+=1;await persistReplicas(row,replicas);return}
    const account=accounts.find(x=>x.id===chosenStorage.id)!;
    let replica:CloudDestination={state:'UPLOADING',accountId:account.id,accountEmail:account.email,folderId:account.folderId,remotePath:'/PhotoSync/'};replicas.push(replica);await persistReplicas(row,replicas);
    try{
      const token=await account.client.getAccessToken();if(!token.token)throw new Error('Drive access token unavailable');
      const mime=row.mimeType||mimeTypeForFilename(row.filename);
      const session=await createResumableUploadSession(token.token,{name:row.filename,mimeType:mime,sizeBytes:row.size,folderId:account.folderId,appProperties:{photosyncKey:row.key,photosyncSha256:row.sha256}});
      const response=await fetch(session,{method:'PUT',headers:{'content-type':mime,'content-length':String(row.size)},body:createReadStream(row.path) as any,duplex:'half'} as any);if(!response.ok)throw new Error(`Drive upload ${response.status}: ${await response.text()}`);const remote=await response.json().catch(()=>({}));if(!remote.id)throw new Error('Drive không trả remoteFileId để xác minh file');
      replica={...replica,state:'VERIFIED',remoteFileId:remote.id,webViewLink:`https://drive.google.com/file/d/${remote.id}/view`,uploadedAt:new Date().toISOString(),verifiedAt:new Date().toISOString()};replicas[replicas.length-1]=replica;lastStatus.cloudUploaded+=1;await persistReplicas(row,replicas);
    }catch(e){replica={...replica,state:'ERROR',message:e instanceof Error?e.message:String(e)};replicas[replicas.length-1]=replica;await persistReplicas(row,replicas);return}
  }
}

async function receiveMedia(req:IncomingMessage,res:ServerResponse){
  const pair=await ensurePairCode(); if(req.headers['x-photosync-pair-code']!==pair){res.writeHead(401);res.end('Invalid pair code');return;}
  const deviceId=String(req.headers['x-photosync-device-id']||'unknown'); const assetId=String(req.headers['x-photosync-asset-id']||''); const key=`${deviceId}:${assetId}`;
  const rows=await readIndex(); if(rows.some(x=>x.key===key)){lastStatus.duplicates+=1;res.writeHead(208,{'content-type':'application/json'});res.end(JSON.stringify({state:'ALREADY_RECEIVED'}));return;}
  const filename=safeFilename(decodeURIComponent(String(req.headers['x-photosync-filename']||`media-${Date.now()}`))); const createdAt=Number(req.headers['x-photosync-created-at']||Date.now());
  const declaredMediaType=String(req.headers['x-photosync-media-type']||'photo')==='video'?'video':'photo';
  const declaredMime=String(req.headers['content-type']||'').split(';')[0].trim();const mimeType=declaredMime&&declaredMime!=='application/octet-stream'?declaredMime:mimeTypeForFilename(filename);
  const date=new Date(Number.isFinite(createdAt)?createdAt:Date.now()); const folder=path.join(libraryDir(),String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'));
  await fs.mkdir(incomingDir(),{recursive:true});await fs.mkdir(folder,{recursive:true}); const tmp=path.join(incomingDir(),`${crypto.randomUUID()}.part`); await pipeline(req,createWriteStream(tmp));
  const stat=await fs.stat(tmp); const hash=await hashFile(tmp); let target=path.join(folder,filename); try{await fs.access(target);target=path.join(folder,`${path.parse(filename).name}-${hash.slice(0,8)}${path.extname(filename)}`)}catch{}
  await fs.rename(tmp,target); const row:MediaIndexRow={key,assetId,deviceId,filename,path:target,size:stat.size,createdAt,receivedAt:new Date().toISOString(),sha256:hash,mimeType,mediaType:declaredMediaType,videoProcessing:declaredMediaType==='video'?'queued':undefined,cloudReplicas:[]}; rows.push(row); await writeIndex(rows);
  lastStatus={...lastStatus,state:'idle',received:lastStatus.received+1,message:`Đã nhận ${filename}`,lastRunAt:new Date().toISOString()}; notifyRenderer('photosync:file-received',{name:filename,path:target});
  res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({state:'LOCAL_STORED',sha256:hash,path:target,processing:row.videoProcessing}));
  if(declaredMediaType==='video')void processVideoRow(key);void enqueueCloudUpload(row);
}

async function desktopStatus():Promise<DesktopStatus>{
  const rows=await readIndex();
  return {...lastStatus,cloudUploaded:rows.reduce((sum,row)=>sum+replicasOf(row).filter(isVerified).length,0),cloudBlocked:rows.filter(row=>new Set(replicasOf(row).filter(isVerified).map(r=>r.accountId)).size<TARGET_CLOUD_REPLICAS).length,receiverUrl:`http://${lanAddress()}:${RECEIVER_PORT}`,publicUrl:PUBLIC_TUNNEL_URL,tunnelHealthy:cloudflaredProcess!==null,pairCode:await ensurePairCode(),libraryPath:libraryDir(),driveAccounts:(await savedDriveAccounts()).length};
}

async function listCloudUploads():Promise<CloudUploadItem[]>{
  const rows=await readIndex();
  const saved=await savedDriveAccounts();
  const emails=new Map(saved.map(account=>[account.id,account.email||account.id]));
  return rows.flatMap(row=>{const replicas=replicasOf(row);const list=replicas.length?replicas:[{state:'QUEUED' as CloudState,message:'Đang chờ chọn 2 tài khoản Drive'}];return list.map(replica=>({key:row.key,filename:row.filename,size:row.size,receivedAt:row.receivedAt,deviceId:row.deviceId,state:replica.state==='BLOCKED'?'QUEUED':replica.state,accountId:replica.accountId,accountEmail:replica.accountEmail||(replica.accountId?emails.get(replica.accountId):undefined),folderId:replica.folderId,remotePath:replica.remotePath,remoteFileId:replica.remoteFileId,webViewLink:replica.webViewLink||(replica.remoteFileId?`https://drive.google.com/file/d/${replica.remoteFileId}/view`:undefined),uploadedAt:replica.uploadedAt,verifiedAt:replica.verifiedAt,message:replica.state==='BLOCKED'?'Đang chờ tài khoản Drive phù hợp; hệ thống sẽ tự thử lại.':replica.message}))}).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
}

async function cloudflaredExecutable(){
  const candidates=[process.env.PHOTOSYNC_CLOUDFLARED_PATH,app.isPackaged?path.join(process.resourcesPath,'cloudflared'):'','/opt/homebrew/bin/cloudflared','/usr/local/bin/cloudflared'].filter(Boolean) as string[];
  for(const candidate of candidates)try{await fs.access(candidate);return candidate}catch{}
  return 'cloudflared';
}

async function startCloudflareTunnel(){
  if(cloudflareStopping||cloudflaredProcess)return;
  const config=path.join(stateDir(),'cloudflare','config.yml');
  try{await fs.access(config)}catch{console.warn('PhotoSync Cloudflare tunnel config not found',config);return}
  const executable=await cloudflaredExecutable();
  const child=spawn(executable,['tunnel','--config',config,'run'],{stdio:['ignore','pipe','pipe']});
  cloudflaredProcess=child;
  child.stdout?.on('data',data=>console.log('cloudflared:',String(data).trim()));
  child.stderr?.on('data',data=>console.log('cloudflared:',String(data).trim()));
  child.on('error',error=>console.error('PhotoSync cloudflared failed',error));
  child.on('exit',()=>{
    if(cloudflaredProcess===child)cloudflaredProcess=null;
    if(!cloudflareStopping){
      if(cloudflareRestart)clearTimeout(cloudflareRestart);
      cloudflareRestart=setTimeout(()=>void startCloudflareTunnel(),5_000);
    }
  });
}

async function checkCloudflareTunnel(){
  try{
    const response=await fetch(`${PUBLIC_TUNNEL_URL}/api/v1/status`,{headers:{'x-photosync-pair-code':await ensurePairCode()},signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`Tunnel health ${response.status}`);
  }catch(error){
    console.error('PhotoSync tunnel health check failed; restarting',error);
    const child=cloudflaredProcess;cloudflaredProcess=null;child?.kill();
    await startCloudflareTunnel();
  }
}

function startCloudflareTunnelSupervisor(){
  cloudflareStopping=false;
  void startCloudflareTunnel();
  if(cloudflareMonitor)clearInterval(cloudflareMonitor);
  cloudflareMonitor=setInterval(()=>void checkCloudflareTunnel(),120_000);
}

function stopCloudflareTunnelSupervisor(){
  cloudflareStopping=true;
  if(cloudflareMonitor)clearInterval(cloudflareMonitor);
  if(cloudflareRestart)clearTimeout(cloudflareRestart);
  cloudflareMonitor=null;cloudflareRestart=null;
  cloudflaredProcess?.kill();cloudflaredProcess=null;
}

async function startReceiver(){
  if(receiver)return; receiver=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url||'/','http://localhost'); const pair=await ensurePairCode();
    if(req.headers['x-photosync-pair-code']!==pair){res.writeHead(401);res.end('Invalid pair code');return;}
    if(req.method==='GET'&&url.pathname==='/api/v1/status'){const index=await readIndex();res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({name:os.hostname(),version:'1',libraryPath:libraryDir(),received:index.length}));return;}
    if(req.method==='GET'&&url.pathname==='/api/v1/library'){
      const items=await listLocalMedia();const rows=new Map((await readIndex()).map(row=>[row.key,row]));
      res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      res.end(JSON.stringify(items.map(item=>{const row=rows.get(item.key);return {key:item.key,assetId:item.key.split(':').slice(1).join(':')||item.key,filename:item.name,size:item.size,createdAt:row?.createdAt||Date.parse(item.modifiedAt),mediaType:row?.mediaType||(isVideoFilename(item.name)?'video':'photo'),mimeType:row?.mimeType||mimeTypeForFilename(item.name),width:row?.width||0,height:row?.height||0,duration:row?.duration||0,rotation:row?.rotation,fps:row?.fps,bitrate:row?.bitrate,container:row?.container,videoCodec:row?.videoCodec,audioCodec:row?.audioCodec,videoProcessing:row?.videoProcessing,videoError:row?.videoError,thumbnailAvailable:Boolean(row?.thumbnailPath),playbackAvailable:Boolean(row?.playbackPath),cloudAvailable:item.cloudAvailable}})));return;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/v1/thumbnail/')){
      const key=decodeURIComponent(url.pathname.slice('/api/v1/thumbnail/'.length));const row=(await readIndex()).find(item=>item.key===key);if(!row?.thumbnailPath){res.writeHead(404);res.end('Thumbnail unavailable');return;}try{await streamNodeFile(req,res,row.thumbnailPath,'image/jpeg');return}catch{res.writeHead(404);res.end('Thumbnail unavailable');return;}
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/v1/playback/')){
      const key=decodeURIComponent(url.pathname.slice('/api/v1/playback/'.length));const row=(await readIndex()).find(item=>item.key===key);if(!row){res.writeHead(404);res.end('Not found');return;}if(row.playbackPath){try{await streamNodeFile(req,res,row.playbackPath,'video/mp4');return}catch{}}
      try{await streamNodeFile(req,res,row.path,row.mimeType||mimeTypeForFilename(row.filename));return}catch{}
      const response=await fetchCloudMedia(row,new Request(`${PUBLIC_TUNNEL_URL}/api/v1/media/${encodeURIComponent(key)}`,{headers:req.headers.range?{range:req.headers.range}:{}}));res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([name])=>['content-type','content-length','content-range','accept-ranges'].includes(name.toLowerCase()))));if(response.body)Readable.fromWeb(response.body as any).pipe(res);else res.end();return;
    }
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/v1/media/')){
      const key=decodeURIComponent(url.pathname.slice('/api/v1/media/'.length));try{const result=await deleteManagedMedia(key);res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch(error){const message=error instanceof Error?error.message:String(error);res.writeHead(message==='MEDIA_NOT_FOUND'?404:409,{'content-type':'application/json'});res.end(JSON.stringify({error:message}));}return;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/api/v1/media/')){
      const key=decodeURIComponent(url.pathname.slice('/api/v1/media/'.length));const row=(await readIndex()).find(item=>item.key===key);
      if(!row){res.writeHead(404);res.end('Not found');return}
      try{await streamNodeFile(req,res,row.path,row.mimeType||mimeTypeForFilename(row.filename));return}catch{}
      const response=await fetchCloudMedia(row,new Request(`${PUBLIC_TUNNEL_URL}${url.pathname}`,{headers:req.headers.range?{range:req.headers.range}:{}}));
      const headers=Object.fromEntries([...response.headers].filter(([name])=>['content-type','content-length','content-range','accept-ranges'].includes(name.toLowerCase())));if(!headers['content-type'])headers['content-type']=row.mimeType||mimeTypeForFilename(row.filename);
      res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body as any).pipe(res);else res.end();return;
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/media'){await receiveMedia(req,res);return;} res.writeHead(404);res.end('Not found');
  }catch(e){console.error(e);res.writeHead(500);res.end(e instanceof Error?e.message:String(e))}}); receiver.listen(RECEIVER_PORT,'0.0.0.0');
}

function createWindow(){const win=new BrowserWindow({width:1500,height:940,minWidth:1040,minHeight:700,backgroundColor:'#ffffff',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',trafficLightPosition:process.platform==='darwin'?{x:18,y:22}:undefined,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});mainWindow=win;win.on('closed',()=>{if(mainWindow===win)mainWindow=null});const devUrl=process.env.VITE_DEV_SERVER_URL||'http://localhost:5173';if(!app.isPackaged)win.loadURL(devUrl);else win.loadFile(path.join(__dirname,'../dist/index.html'),{query:{build:String(Date.now())}});}

ipcMain.handle('photosync:status',()=>desktopStatus());
ipcMain.handle('photosync:backup-health',()=>backupHealthSnapshot());
ipcMain.handle('photosync:list-local',()=>listLocalMedia());
ipcMain.handle('photosync:list-cloud-uploads',()=>listCloudUploads());
ipcMain.handle('photosync:open-library',()=>shell.openPath(libraryDir()));
ipcMain.handle('photosync:open-external',(_event,url:string)=>{if(/^https:\/\/drive\.google\.com\//.test(url))return shell.openExternal(url)});
ipcMain.handle('photosync:add-google',()=>connectGoogle());
ipcMain.handle('photosync:list-google-accounts',()=>listDriveAccounts());
ipcMain.handle('photosync:remove-google-account',(_event,accountId:string)=>removeDriveAccount(accountId));
ipcMain.handle('photosync:retry-cloud',async()=>{await retryQueuedCloud();return desktopStatus()});

app.whenReady().then(async()=>{await fs.mkdir(libraryDir(),{recursive:true});await fs.mkdir(videoCacheDir(),{recursive:true});await startReceiver();startCloudflareTunnelSupervisor();protocol.handle('photosync',async request=>{const url=new URL(request.url);if(url.hostname!=='media')return new Response('Not found',{status:404});const key=decodeURIComponent(url.pathname.replace(/^\//,''));const row=(await readIndex()).find(x=>x.key===key);if(!row)return new Response('Not found',{status:404});
    try{
      const usePlayback=isVideoFilename(row.filename)&&Boolean(row.playbackPath);const sourcePath=usePlayback?row.playbackPath!:row.path;const stat=await fs.stat(sourcePath);const range=request.headers.get('range');const contentType=usePlayback?'video/mp4':row.mimeType||mimeTypeForFilename(row.filename);
      if(range){const match=/bytes=(\d+)-(\d*)/.exec(range);if(match){const start=Number(match[1]);const end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;if(start>=stat.size||end<start)return new Response(null,{status:416,headers:{'content-range':`bytes */${stat.size}`}});return new Response(Readable.toWeb(createReadStream(sourcePath,{start,end})) as ReadableStream,{status:206,headers:{'content-type':contentType,'content-length':String(end-start+1),'content-range':`bytes ${start}-${end}/${stat.size}`,'accept-ranges':'bytes','cache-control':'no-store'}})}}
      return new Response(Readable.toWeb(createReadStream(sourcePath)) as ReadableStream,{status:200,headers:{'content-type':contentType,'content-length':String(stat.size),'accept-ranges':'bytes','cache-control':'no-store'}});
    }catch{return fetchCloudMedia(row,request)}
  });createWindow();const rows=await readIndex();for(const row of rows.filter(r=>isVideoFilename(r.filename)&&r.videoProcessing!=='ready'))void processVideoRow(row.key);void retryQueuedCloud();repairSweepTimer=setInterval(()=>void retryQueuedCloud(),60_000);app.on('activate',()=>BrowserWindow.getAllWindows().length===0&&createWindow())});
app.on('before-quit',()=>{if(repairSweepTimer)clearInterval(repairSweepTimer);repairSweepTimer=null;stopCloudflareTunnelSupervisor()});
app.on('window-all-closed',()=>process.platform!=='darwin'&&app.quit());
