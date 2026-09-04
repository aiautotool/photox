import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { MediaApiScope } from '@photox/media-api';
import { OneTimeTicketStore } from '@photosync/core';
import { requireActiveDesktopWorkspaceAuth } from './workspaceAuth.js';
import { billingMutationHttpStatus } from './billingMutationTransport.js';
import { updateDriveAllocationPolicyForWeb } from './driveAllocationDesktopTransport.js';

export type WebRole='owner'|'admin'|'member'|'viewer';
export type WebEdgeEvent='migration-updated'|'file-received'|'storage-updated'|'tunnel-state';
export type WebPrincipal={subject:string;workspaceId:string;workspaceRole?:WebRole;deviceId?:string;sessionId?:string;scopes:MediaApiScope[]};
export type WebAuditInput={action:string;targetType?:string;targetId?:string;metadata?:Record<string,unknown>};

type BrowserMedia={key:string;url?:string;thumbnailUri?:string;[key:string]:unknown};
type WebSession={accessToken:string;refreshToken:string;accessExpiresAt:number;sessionId:string};

export interface WebEdgeHandlers {
  authorizeAccessToken(token:string,required:MediaApiScope[]):Promise<WebPrincipal>;
  createWebSession(input:{deviceId:string;deviceName?:string}):Promise<WebSession>;
  refreshSession(refreshToken:string):Promise<{accessToken:string;accessExpiresAt:number;sessionId:string}>;
  revokeSession(sessionId:string):Promise<void>;
  handleStripeWebhook?(rawBody:Buffer,signatureHeader:string,now:number):Promise<unknown>|unknown;
  getWorkspaceOverview?(principal:WebPrincipal):Promise<unknown>;
  getWorkspaceSubscription?(principal:WebPrincipal):Promise<unknown>;
  mutateWorkspaceSubscription?(principal:WebPrincipal,body:unknown,idempotencyKey:string):Promise<unknown>;
  listWorkspaceDevices?(principal:WebPrincipal):Promise<unknown>;
  listWorkspaceSessions?(principal:WebPrincipal):Promise<unknown>;
  revokeWorkspaceSession?(principal:WebPrincipal,sessionId:string):Promise<unknown>;
  revokeWorkspaceDevice?(principal:WebPrincipal,deviceId:string):Promise<unknown>;
  updateGoogleDriveAllocation?(principal:WebPrincipal,accountId:string,body:unknown):Promise<unknown>;
  appendAudit(principal:WebPrincipal,event:WebAuditInput):Promise<void>;
  getStatus():Promise<unknown>;
  getTunnelStatus():Promise<unknown>;
  listLocalMedia():Promise<unknown>;
  listCloudUploads():Promise<unknown>;
  getBackupHealth():Promise<unknown>;
  openLibrary():Promise<unknown>;
  addGoogleAccount():Promise<unknown>;
  listGoogleAccounts():Promise<unknown>;
  removeGoogleAccount(accountId:string):Promise<unknown>;
  retryCloud():Promise<unknown>;
  listGooglePhotosAccounts():Promise<unknown>;
  connectGooglePhotosAccount(capability:'picker'|'append'):Promise<unknown>;
  removeGooglePhotosAccount(accountId:string):Promise<unknown>;
  listMigrations():Promise<unknown>;
  getMigration(jobId:string):Promise<unknown>;
  createMigration(input:any):Promise<unknown>;
  materializeMigration(jobId:string):Promise<unknown>;
  runMigration(jobId:string):Promise<unknown>;
  pauseMigration(jobId:string):Promise<unknown>;
  resumeMigration(jobId:string):Promise<unknown>;
  cancelMigration(jobId:string):Promise<unknown>;
  retryMigration(jobId:string):Promise<unknown>;
  streamMedia(req:IncomingMessage,res:ServerResponse,key:string,variant:'original'|'playback'|'thumbnail',workspaceId:string):Promise<void>;
}

export interface WebEdgeConfig {
  enabled:boolean;
  host:string;
  port:number;
  allowedOrigins:string[];
  staticDir:string;
  publicBaseUrl?:string;
  rateLimitPerMinute:number;
}

type Bucket={minute:number;count:number};
const ROLE_RANK:Record<WebRole,number>={viewer:0,member:1,admin:2,owner:3};
const MEDIA_TTL_SECONDS=10*60;
const WEB_REFRESH_COOKIE='photox_refresh';
const WEB_CSRF_COOKIE='photox_csrf';
const WEB_REFRESH_MAX_AGE=30*24*60*60;
const WEB_LOGIN_TTL_MS=2*60_000;
const STRIPE_WEBHOOK_PATH='/api/web/v1/billing/webhooks/stripe';

export function webEdgeConfigFromEnv(staticDir:string):WebEdgeConfig{
  const enabled=process.env.PHOTOX_WEB_ENABLED==='true';
  const port=Number(process.env.PHOTOX_WEB_PORT||43118);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PHOTOX_WEB_PORT is invalid');
  return {
    enabled,
    host:process.env.PHOTOX_WEB_HOST||'127.0.0.1',
    port,
    allowedOrigins:(process.env.PHOTOX_WEB_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean),
    staticDir,
    publicBaseUrl:process.env.PHOTOX_WEB_PUBLIC_BASE_URL?.replace(/\/$/,''),
    rateLimitPerMinute:Math.max(30,Number(process.env.PHOTOX_WEB_RATE_LIMIT||300)),
  };
}

export class PhotoXWebEdgeServer {
  private server:http.Server|null=null;
  private ws:WebSocketServer|null=null;
  private sockets=new Map<WebSocket,WebPrincipal>();
  private buckets=new Map<string,Bucket>();
  private readonly mediaSigningKey=crypto.randomBytes(32);
  private readonly loginTickets=new OneTimeTicketStore<WebSession>();
  constructor(private readonly config:WebEdgeConfig,private readonly handlers:WebEdgeHandlers){}

  async issueLoginTicket(){
    this.loginTickets.prune();
    const ticket=crypto.randomBytes(32).toString('base64url');
    const session=await this.handlers.createWebSession({deviceId:`web_${crypto.randomBytes(16).toString('hex')}`,deviceName:'PhotoX Web'});
    const expiresAt=Date.now()+WEB_LOGIN_TTL_MS;
    this.loginTickets.put(ticket,session,expiresAt);
    const localHost=['0.0.0.0','::','::0'].includes(this.config.host)?'127.0.0.1':this.config.host;
    const base=this.config.publicBaseUrl||`http://${localHost}:${this.config.port}`;
    return {url:`${base}/#ticket=${encodeURIComponent(ticket)}`,expiresAt};
  }

  async start(){
    if(!this.config.enabled||this.server)return;
    this.server=http.createServer((req,res)=>void this.handle(req,res));
    this.ws=new WebSocketServer({noServer:true});
    this.server.on('upgrade',(req,socket,head)=>{
      void (async()=>{
        const url=new URL(req.url||'/','http://localhost');
        if(url.pathname!=='/api/web/v1/events'||!this.originAllowed(req)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
        try{
          const principal=await this.authorize(req,['media:read']);
          this.ws!.handleUpgrade(req,socket,head,client=>{this.sockets.set(client,principal);client.on('close',()=>this.sockets.delete(client));});
        }catch{socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();}
      })();
    });
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.config.port,this.config.host,()=>resolve());});
  }

  async stop(){
    for(const socket of this.sockets.keys())socket.close();this.sockets.clear();
    await new Promise<void>(resolve=>this.server?.close(()=>resolve())??resolve());
    this.ws?.close();this.ws=null;this.server=null;
  }

  publish(event:WebEdgeEvent,payload:unknown){
    const payloadWorkspace=payload&&typeof payload==='object'&&'workspaceId' in payload?String((payload as any).workspaceId||''):undefined;
    for(const [socket,principal] of this.sockets){
      if(socket.readyState!==WebSocket.OPEN)continue;
      if(payloadWorkspace&&payloadWorkspace!==principal.workspaceId)continue;
      socket.send(JSON.stringify({event,payload,workspaceId:principal.workspaceId,at:new Date().toISOString()}));
    }
  }

  private tokenFromRequest(req:IncomingMessage){
    const bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''))?.[1];
    const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(v=>v.trim());
    return bearer||protocols.find(v=>v!=='photox-v2'&&v!=='photox-v1');
  }

  private authorize(req:IncomingMessage,required:MediaApiScope[]){
    const token=this.tokenFromRequest(req);if(!token)throw new Error('AUTH_REQUIRED');
    return this.handlers.authorizeAccessToken(token,required);
  }

  private mediaSignature(workspaceId:string,key:string,variant:string,expires:number){
    return crypto.createHmac('sha256',this.mediaSigningKey).update(`${workspaceId}\n${variant}\n${key}\n${expires}`).digest('base64url');
  }

  private mediaUrl(principal:WebPrincipal,key:string,variant:'media'|'playback'|'thumbnail'){
    const expires=Math.floor(Date.now()/1000)+MEDIA_TTL_SECONDS;
    const sig=this.mediaSignature(principal.workspaceId,key,variant,expires);
    const base=this.config.publicBaseUrl||'';
    return `${base}/api/web/v1/${variant}/${encodeURIComponent(key)}?wid=${encodeURIComponent(principal.workspaceId)}&exp=${expires}&sig=${encodeURIComponent(sig)}`;
  }

  private signedMediaPrincipal(url:URL):WebPrincipal|undefined{
    const match=/^\/api\/web\/v1\/(media|playback|thumbnail)\/([^/]+)$/.exec(url.pathname);if(!match)return;
    const workspaceId=url.searchParams.get('wid')||'';
    const expires=Number(url.searchParams.get('exp')||0);const supplied=url.searchParams.get('sig')||'';
    if(!workspaceId||!Number.isInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+MEDIA_TTL_SECONDS+60)return;
    const expected=this.mediaSignature(workspaceId,decodeURIComponent(match[2]),match[1],expires);
    if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return;
    return {subject:'signed-media',workspaceId,workspaceRole:'viewer',scopes:['media:download']};
  }

  private originAllowed(req:IncomingMessage){
    const origin=String(req.headers.origin||'');
    if(!origin)return true;
    if(this.config.allowedOrigins.length)return this.config.allowedOrigins.includes(origin);
    try{const parsed=new URL(origin);return ['127.0.0.1','localhost',this.config.host].includes(parsed.hostname);}catch{return false;}
  }

  private rateAllowed(req:IncomingMessage){
    const key=req.socket.remoteAddress||'unknown';const minute=Math.floor(Date.now()/60_000);const bucket=this.buckets.get(key);
    if(!bucket||bucket.minute!==minute){this.buckets.set(key,{minute,count:1});return true;}
    bucket.count+=1;return bucket.count<=this.config.rateLimitPerMinute;
  }

  private requireRole(principal:WebPrincipal,role:WebRole){
    const actual=principal.workspaceRole??'viewer';
    return ROLE_RANK[actual]>=ROLE_RANK[role];
  }

  private cookies(req:IncomingMessage){
    const result:Record<string,string>={};
    for(const entry of String(req.headers.cookie||'').split(';')){const at=entry.indexOf('=');if(at<=0)continue;const key=decodeURIComponent(entry.slice(0,at).trim());const value=decodeURIComponent(entry.slice(at+1).trim());result[key]=value;}
    return result;
  }

  private secureCookie(req:IncomingMessage){
    return Boolean(this.config.publicBaseUrl?.startsWith('https://')||String(req.headers['x-forwarded-proto']||'').split(',')[0]?.trim()==='https');
  }

  private sessionCookies(req:IncomingMessage,refreshToken:string,csrfToken:string){
    const secure=this.secureCookie(req)?'; Secure':'';
    return [`${WEB_REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; Path=/api/web/v1/auth; HttpOnly; SameSite=Strict; Max-Age=${WEB_REFRESH_MAX_AGE}${secure}`,`${WEB_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=${WEB_REFRESH_MAX_AGE}${secure}`];
  }

  private clearSessionCookies(req:IncomingMessage){
    const secure=this.secureCookie(req)?'; Secure':'';
    return [`${WEB_REFRESH_COOKIE}=; Path=/api/web/v1/auth; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,`${WEB_CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0${secure}`];
  }

  private csrfValid(req:IncomingMessage){
    const cookies=this.cookies(req);const cookieToken=cookies[WEB_CSRF_COOKIE]||'';const header=String(req.headers['x-csrf-token']||'');
    if(!cookieToken||!header||cookieToken.length!==header.length)return false;
    return crypto.timingSafeEqual(Buffer.from(cookieToken),Buffer.from(header));
  }

  private cors(req:IncomingMessage,res:ServerResponse){
    const origin=String(req.headers.origin||'');if(origin&&this.originAllowed(req)){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
    res.setHeader('access-control-allow-headers','authorization,content-type,range,x-csrf-token,idempotency-key');
    res.setHeader('access-control-allow-credentials','true');
    res.setHeader('access-control-allow-methods','GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');
  }

  private async rawBody(req:IncomingMessage){
    const chunks:Buffer[]=[];let total=0;
    for await(const chunk of req){const b=Buffer.from(chunk);total+=b.length;if(total>1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(b);}
    return Buffer.concat(chunks);
  }

  private async body(req:IncomingMessage){
    const raw=await this.rawBody(req);
    if(!raw.length)return {};
    return JSON.parse(raw.toString('utf8'));
  }

  private json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}

  private deviceApi(){return requireActiveDesktopWorkspaceAuth();}

  private async handle(req:IncomingMessage,res:ServerResponse){
    this.cors(req,res);
    if(req.method==='OPTIONS'){res.writeHead(this.originAllowed(req)?204:403);res.end();return;}
    if(!this.originAllowed(req)){this.json(res,403,{error:'ORIGIN_FORBIDDEN'});return;}
    if(!this.rateAllowed(req)){res.setHeader('retry-after','60');this.json(res,429,{error:'RATE_LIMITED'});return;}
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname===STRIPE_WEBHOOK_PATH&&req.method==='POST'){
      try{
        const raw=await this.rawBody(req);
        const signature=String(req.headers['stripe-signature']||'');
        if(!signature)throw new Error('BILLING_WEBHOOK_SIGNATURE_REQUIRED');
        const now=Date.now();
        const value=await (this.handlers.handleStripeWebhook?.(raw,signature,now)??Promise.resolve(this.deviceApi().handleStripeWebhook(raw,signature,now)));
        this.json(res,200,value);
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        const status=message==='BILLING_WEBHOOK_NOT_CONFIGURED'?503:message==='REQUEST_TOO_LARGE'?413:400;
        this.json(res,status,{error:'BILLING_WEBHOOK_REJECTED'});
      }
      return;
    }
    if(url.pathname==='/api/web/v1/auth/ticket'&&req.method==='POST'){
      try{const b=await this.body(req);const ticket=String(b.ticket||'');if(!ticket)throw new Error('LOGIN_TICKET_REQUIRED');const session=this.loginTickets.consume(ticket);if(!session)throw new Error('LOGIN_TICKET_INVALID_OR_EXPIRED');const csrfToken=crypto.randomBytes(24).toString('base64url');res.setHeader('set-cookie',this.sessionCookies(req,session.refreshToken,csrfToken));this.json(res,200,{accessToken:session.accessToken,accessExpiresAt:session.accessExpiresAt,sessionId:session.sessionId,csrfToken});}catch(error){this.json(res,401,{error:error instanceof Error?error.message:String(error)});}return;
    }
    if(url.pathname==='/api/web/v1/auth/bootstrap'&&req.method==='POST'){
      try{const b=await this.body(req);const refreshToken=String(b.refreshToken||'');if(!refreshToken)throw new Error('REFRESH_TOKEN_REQUIRED');const next=await this.handlers.refreshSession(refreshToken);const csrfToken=crypto.randomBytes(24).toString('base64url');res.setHeader('set-cookie',this.sessionCookies(req,refreshToken,csrfToken));this.json(res,200,{...next,csrfToken});}catch(error){this.json(res,401,{error:error instanceof Error?error.message:String(error)});}return;
    }
    if(url.pathname==='/api/web/v1/auth/refresh'&&req.method==='POST'){
      try{if(!this.csrfValid(req))throw new Error('CSRF_REQUIRED');const refreshToken=this.cookies(req)[WEB_REFRESH_COOKIE]||'';if(!refreshToken)throw new Error('REFRESH_TOKEN_REQUIRED');const next=await this.handlers.refreshSession(refreshToken);const csrfToken=this.cookies(req)[WEB_CSRF_COOKIE]||crypto.randomBytes(24).toString('base64url');res.setHeader('set-cookie',this.sessionCookies(req,refreshToken,csrfToken));this.json(res,200,{...next,csrfToken});}catch(error){res.setHeader('set-cookie',this.clearSessionCookies(req));this.json(res,401,{error:error instanceof Error?error.message:String(error)});}return;
    }
    if(url.pathname.startsWith('/api/web/v1/')){
      try{
        const signed=this.signedMediaPrincipal(url);
        const required:MediaApiScope[]=signed?['media:download']:url.pathname.startsWith('/api/web/v1/media/')||url.pathname.startsWith('/api/web/v1/playback/')||url.pathname.startsWith('/api/web/v1/thumbnail/')?['media:download']:['media:read'];
        const principal=signed??await this.authorize(req,required);
        await this.api(req,res,url,principal);return;
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        this.json(res,message.includes('ROLE_FORBIDDEN')?403:message.includes('NOT_FOUND')?404:401,{error:message});return;
      }
    }
    await this.static(req,res,url.pathname);
  }

  private async api(req:IncomingMessage,res:ServerResponse,url:URL,principal:WebPrincipal){
    const p=url.pathname,m=req.method||'GET';
    const read=async(fn:()=>Promise<unknown>)=>this.json(res,200,await fn());
    const mutate=async(role:WebRole,audit:WebAuditInput,fn:()=>Promise<unknown>)=>{if(!this.requireRole(principal,role)){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}const value=await fn();await this.handlers.appendAudit(principal,audit);this.json(res,200,value);};
    if(m!=='GET'&&m!=='HEAD'&&!this.csrfValid(req)){this.json(res,403,{error:'CSRF_REQUIRED'});return;}
    if(m==='POST'&&p==='/api/web/v1/auth/revoke'){
      const b=await this.body(req);if(principal.sessionId&&String(b.sessionId||'')!==principal.sessionId&&!this.requireRole(principal,'admin')){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}
      const targetSession=String(b.sessionId||principal.sessionId||'');await this.handlers.revokeSession(targetSession);await this.handlers.appendAudit(principal,{action:'web.session.revoke',targetType:'session',targetId:targetSession});res.setHeader('set-cookie',this.clearSessionCookies(req));res.writeHead(204);res.end();return;
    }
    if(m==='GET'&&p==='/api/web/v1/session')return this.json(res,200,{subject:principal.subject,workspaceId:principal.workspaceId,workspaceRole:principal.workspaceRole,deviceId:principal.deviceId,sessionId:principal.sessionId,scopes:principal.scopes});
    if(m==='GET'&&p==='/api/web/v1/workspace')return read(()=>this.handlers.getWorkspaceOverview?.(principal)??Promise.resolve(this.deviceApi().getWorkspaceOverview(principal)));
    if(m==='GET'&&p==='/api/web/v1/workspace/subscription')return read(()=>this.handlers.getWorkspaceSubscription?.(principal)??Promise.resolve(this.deviceApi().getWorkspaceSubscription(principal)));
    if(m==='POST'&&p==='/api/web/v1/workspace/subscription/mutations'){
      if(!this.requireRole(principal,'admin')){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}
      try{
        const b=await this.body(req);const idempotencyKey=String(req.headers['idempotency-key']||'');
        const value=await (this.handlers.mutateWorkspaceSubscription?.(principal,b,idempotencyKey)??this.deviceApi().mutateWorkspaceSubscription(principal,b,idempotencyKey));
        await this.handlers.appendAudit(principal,{action:'web.subscription.mutate',targetType:'subscription',metadata:{operation:typeof b?.operation==='string'?b.operation:'unknown'}});
        this.json(res,200,value);
      }catch(error){this.json(res,billingMutationHttpStatus(error),{error:error instanceof Error?error.message:String(error)});}
      return;
    }
    if(m==='GET'&&p==='/api/web/v1/devices')return read(()=>this.handlers.listWorkspaceDevices?.(principal)??Promise.resolve(this.deviceApi().listDevices(principal)));
    if(m==='GET'&&p==='/api/web/v1/sessions')return read(()=>this.handlers.listWorkspaceSessions?.(principal)??Promise.resolve(this.deviceApi().listSessions(principal)));
    let match=/^\/api\/web\/v1\/sessions\/([^/]+)$/.exec(p);if(m==='DELETE'&&match){const id=decodeURIComponent(match[1]);const value=await (this.handlers.revokeWorkspaceSession?.(principal,id)??Promise.resolve(this.deviceApi().revokeSession(principal,id)));return this.json(res,200,value);}
    match=/^\/api\/web\/v1\/devices\/([^/]+)$/.exec(p);if(m==='DELETE'&&match){const id=decodeURIComponent(match[1]);const value=await (this.handlers.revokeWorkspaceDevice?.(principal,id)??Promise.resolve(this.deviceApi().revokeDevice(principal,id)));return this.json(res,200,value);}
    if(m==='GET'&&p==='/api/web/v1/status')return read(this.handlers.getStatus);
    if(m==='GET'&&p==='/api/web/v1/tunnel')return read(this.handlers.getTunnelStatus);
    if(m==='GET'&&p==='/api/web/v1/library'){
      const raw=await this.handlers.listLocalMedia();const items=Array.isArray(raw)?raw as BrowserMedia[]:[];
      return this.json(res,200,items.map(item=>({...item,url:this.mediaUrl(principal,item.key,'media'),thumbnailUri:this.mediaUrl(principal,item.key,'thumbnail')})));
    }
    if(m==='GET'&&p==='/api/web/v1/cloud/uploads')return read(this.handlers.listCloudUploads);
    if(m==='GET'&&p==='/api/web/v1/backup/health')return read(this.handlers.getBackupHealth);
    if(m==='POST'&&p==='/api/web/v1/library/open')return mutate('admin',{action:'web.library.open',targetType:'library'},this.handlers.openLibrary);
    if(m==='POST'&&p==='/api/web/v1/google-drive/accounts/connect')return mutate('admin',{action:'web.google_drive.connect',targetType:'provider'},this.handlers.addGoogleAccount);
    if(m==='GET'&&p==='/api/web/v1/google-drive/accounts')return read(this.handlers.listGoogleAccounts);
    match=/^\/api\/web\/v1\/google-drive\/accounts\/([^/]+)\/allocation$/.exec(p);if(m==='PATCH'&&match){
      if(!this.requireRole(principal,'admin')){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}
      const accountId=decodeURIComponent(match[1]);const body=await this.body(req);
      try{
        const value=await (this.handlers.updateGoogleDriveAllocation?.(principal,accountId,body)??updateDriveAllocationPolicyForWeb(principal,accountId,body));
        this.json(res,200,value);
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        const status=message.includes('ROLE_FORBIDDEN')?403:message.includes('NOT_FOUND')?404:message.includes('INVALID')||message.includes('REQUIRED')||message.includes('MUTATION')?400:500;
        this.json(res,status,{error:message.startsWith('DRIVE_')?message:'DRIVE_ALLOCATION_INTERNAL_ERROR'});
      }
      return;
    }
    match=/^\/api\/web\/v1\/google-drive\/accounts\/([^/]+)$/.exec(p);if(m==='DELETE'&&match)return mutate('admin',{action:'web.google_drive.remove',targetType:'provider',targetId:decodeURIComponent(match![1])},()=>this.handlers.removeGoogleAccount(decodeURIComponent(match![1])));
    if(m==='POST'&&p==='/api/web/v1/cloud/retry')return mutate('member',{action:'web.cloud.retry',targetType:'cloud_queue'},this.handlers.retryCloud);
    if(m==='GET'&&p==='/api/web/v1/google-photos/accounts')return read(this.handlers.listGooglePhotosAccounts);
    if(m==='POST'&&p==='/api/web/v1/google-photos/accounts/connect'){const b=await this.body(req);if(!['picker','append'].includes(String(b.capability))){this.json(res,400,{error:'INVALID_CAPABILITY'});return;}return mutate('admin',{action:'web.google_photos.connect',targetType:'provider',metadata:{capability:String(b.capability)}},()=>this.handlers.connectGooglePhotosAccount(b.capability));}
    match=/^\/api\/web\/v1\/google-photos\/accounts\/([^/]+)$/.exec(p);if(m==='DELETE'&&match)return mutate('admin',{action:'web.google_photos.remove',targetType:'provider',targetId:decodeURIComponent(match![1])},()=>this.handlers.removeGooglePhotosAccount(decodeURIComponent(match![1])));
    if(m==='GET'&&p==='/api/web/v1/migrations')return read(this.handlers.listMigrations);
    if(m==='POST'&&p==='/api/web/v1/migrations'){const b=await this.body(req);return mutate('member',{action:'web.migration.create',targetType:'migration',metadata:{sourceAccountId:b.sourceAccountId,target:b.target,targetAccountId:b.targetAccountId}},()=>this.handlers.createMigration(b));}
    match=/^\/api\/web\/v1\/migrations\/([^/]+)$/.exec(p);if(m==='GET'&&match)return read(()=>this.handlers.getMigration(decodeURIComponent(match![1])));
    match=/^\/api\/web\/v1\/migrations\/([^/]+)\/(selection|run|pause|resume|cancel|retry)$/.exec(p);if(m==='POST'&&match){const id=decodeURIComponent(match[1]);const op=match[2];return mutate('member',{action:`web.migration.${op}`,targetType:'migration',targetId:id},()=>op==='selection'?this.handlers.materializeMigration(id):op==='run'?this.handlers.runMigration(id):op==='pause'?this.handlers.pauseMigration(id):op==='resume'?this.handlers.resumeMigration(id):op==='cancel'?this.handlers.cancelMigration(id):this.handlers.retryMigration(id));}
    match=/^\/api\/web\/v1\/(media|playback|thumbnail)\/([^/]+)$/.exec(p);if(m==='GET'&&match){const variant=match[1]==='media'?'original':match[1] as 'playback'|'thumbnail';await this.handlers.streamMedia(req,res,decodeURIComponent(match[2]),variant,principal.workspaceId);return;}
    this.json(res,404,{error:'NOT_FOUND'});
  }

  private async static(req:IncomingMessage,res:ServerResponse,pathname:string){
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const clean=pathname==='/'?'index.html':pathname.replace(/^\//,'');
    const requested=path.resolve(this.config.staticDir,clean);const root=path.resolve(this.config.staticDir)+path.sep;
    let filePath=requested.startsWith(root)?requested:path.join(this.config.staticDir,'index.html');
    try{const stat=await fs.stat(filePath);if(stat.isDirectory())filePath=path.join(filePath,'index.html');}catch{filePath=path.join(this.config.staticDir,'index.html');}
    try{
      let body=await fs.readFile(filePath);
      if(path.basename(filePath)==='index.html'){
        const bootstrap=`<script>const p=new URLSearchParams(location.hash.slice(1));window.__PHOTOSYNC_WEB_CONFIG__={baseUrl:location.origin,accessToken:(sessionStorage.getItem('photox.web.access')||''),loginTicket:(p.get('ticket')||'')};if(location.hash)history.replaceState(null,'',location.pathname+location.search);</script>`;
        body=Buffer.from(body.toString('utf8').replace('</head>',`${bootstrap}</head>`));
      }
      const ext=path.extname(filePath);const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
      res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','content-length':String(body.length),'cache-control':ext==='.html'?'no-store':'public, max-age=31536000, immutable','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
      if(req.method==='HEAD')res.end();else res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  }
}