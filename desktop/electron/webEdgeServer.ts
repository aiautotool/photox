import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

export type WebRole='owner'|'admin'|'member'|'viewer';
export type WebEdgeEvent='migration-updated'|'file-received'|'storage-updated'|'tunnel-state';

type BrowserMedia={key:string;url?:string;thumbnailUri?:string;[key:string]:unknown};

export interface WebEdgeHandlers {
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
  streamMedia(req:IncomingMessage,res:ServerResponse,key:string,variant:'original'|'playback'|'thumbnail'):Promise<void>;
}

export interface WebEdgeConfig {
  enabled:boolean;
  host:string;
  port:number;
  accessToken:string;
  role:WebRole;
  workspaceId:string;
  allowedOrigins:string[];
  staticDir:string;
  publicBaseUrl?:string;
  rateLimitPerMinute:number;
}

type Bucket={minute:number;count:number};
const ROLE_RANK:Record<WebRole,number>={viewer:0,member:1,admin:2,owner:3};
const MEDIA_TTL_SECONDS=10*60;

export function webEdgeConfigFromEnv(staticDir:string):WebEdgeConfig{
  const enabled=process.env.PHOTOX_WEB_ENABLED==='true';
  const accessToken=process.env.PHOTOX_WEB_ACCESS_TOKEN||'';
  if(enabled&&accessToken.length<32)throw new Error('PHOTOX_WEB_ACCESS_TOKEN must be at least 32 characters when Web is enabled');
  const rawRole=process.env.PHOTOX_WEB_ROLE||'owner';
  const role=(['owner','admin','member','viewer'].includes(rawRole)?rawRole:'owner') as WebRole;
  const port=Number(process.env.PHOTOX_WEB_PORT||43118);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PHOTOX_WEB_PORT is invalid');
  return {
    enabled,
    host:process.env.PHOTOX_WEB_HOST||'127.0.0.1',
    port,
    accessToken,
    role,
    workspaceId:process.env.PHOTOX_WORKSPACE_ID||'legacy-personal',
    allowedOrigins:(process.env.PHOTOX_WEB_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean),
    staticDir,
    publicBaseUrl:process.env.PHOTOX_WEB_PUBLIC_BASE_URL?.replace(/\/$/,''),
    rateLimitPerMinute:Math.max(30,Number(process.env.PHOTOX_WEB_RATE_LIMIT||300)),
  };
}

export class PhotoXWebEdgeServer {
  private server:http.Server|null=null;
  private ws:WebSocketServer|null=null;
  private sockets=new Set<WebSocket>();
  private buckets=new Map<string,Bucket>();
  constructor(private readonly config:WebEdgeConfig,private readonly handlers:WebEdgeHandlers){}

  async start(){
    if(!this.config.enabled||this.server)return;
    this.server=http.createServer((req,res)=>void this.handle(req,res));
    this.ws=new WebSocketServer({noServer:true});
    this.server.on('upgrade',(req,socket,head)=>{
      const url=new URL(req.url||'/','http://localhost');
      if(url.pathname!=='/api/web/v1/events'||!this.authorized(req)||!this.originAllowed(req)){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return;}
      this.ws!.handleUpgrade(req,socket,head,client=>{this.sockets.add(client);client.on('close',()=>this.sockets.delete(client));});
    });
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(this.config.port,this.config.host,()=>resolve());});
  }

  async stop(){
    for(const socket of this.sockets)socket.close();this.sockets.clear();
    await new Promise<void>(resolve=>this.server?.close(()=>resolve())??resolve());
    this.ws?.close();this.ws=null;this.server=null;
  }

  publish(event:WebEdgeEvent,payload:unknown){
    const message=JSON.stringify({event,payload,workspaceId:this.config.workspaceId,at:new Date().toISOString()});
    for(const socket of this.sockets)if(socket.readyState===WebSocket.OPEN)socket.send(message);
  }

  private authorized(req:IncomingMessage){
    const bearer=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||''))?.[1];
    const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(v=>v.trim());
    const token=bearer||protocols.find(v=>v!=='photox-v1');
    if(!token||token.length!==this.config.accessToken.length)return false;
    return crypto.timingSafeEqual(Buffer.from(token),Buffer.from(this.config.accessToken));
  }

  private mediaSignature(key:string,variant:string,expires:number){
    return crypto.createHmac('sha256',this.config.accessToken).update(`${this.config.workspaceId}\n${variant}\n${key}\n${expires}`).digest('base64url');
  }

  private mediaUrl(key:string,variant:'media'|'playback'|'thumbnail'){
    const expires=Math.floor(Date.now()/1000)+MEDIA_TTL_SECONDS;
    const sig=this.mediaSignature(key,variant,expires);
    const base=this.config.publicBaseUrl||'';
    return `${base}/api/web/v1/${variant}/${encodeURIComponent(key)}?exp=${expires}&sig=${encodeURIComponent(sig)}`;
  }

  private signedMediaAuthorized(url:URL){
    const match=/^\/api\/web\/v1\/(media|playback|thumbnail)\/([^/]+)$/.exec(url.pathname);if(!match)return false;
    const expires=Number(url.searchParams.get('exp')||0);const supplied=url.searchParams.get('sig')||'';
    if(!Number.isInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+MEDIA_TTL_SECONDS+60)return false;
    const expected=this.mediaSignature(decodeURIComponent(match[2]),match[1],expires);
    if(supplied.length!==expected.length)return false;
    return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
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

  private requireRole(role:WebRole){return ROLE_RANK[this.config.role]>=ROLE_RANK[role];}

  private cors(req:IncomingMessage,res:ServerResponse){
    const origin=String(req.headers.origin||'');if(origin&&this.originAllowed(req)){res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');}
    res.setHeader('access-control-allow-headers','authorization,content-type,range');
    res.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS');
    res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');
  }

  private async body(req:IncomingMessage){
    const chunks:Buffer[]=[];let total=0;
    for await(const chunk of req){const b=Buffer.from(chunk);total+=b.length;if(total>1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(b);}
    if(!chunks.length)return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  private json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}

  private async handle(req:IncomingMessage,res:ServerResponse){
    this.cors(req,res);
    if(req.method==='OPTIONS'){res.writeHead(this.originAllowed(req)?204:403);res.end();return;}
    if(!this.originAllowed(req)){this.json(res,403,{error:'ORIGIN_FORBIDDEN'});return;}
    if(!this.rateAllowed(req)){res.setHeader('retry-after','60');this.json(res,429,{error:'RATE_LIMITED'});return;}
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname.startsWith('/api/web/v1/')){
      if(!this.authorized(req)&&!this.signedMediaAuthorized(url)){this.json(res,401,{error:'AUTH_REQUIRED'});return;}
      try{await this.api(req,res,url);return;}catch(error){this.json(res,500,{error:error instanceof Error?error.message:String(error)});return;}
    }
    await this.static(req,res,url.pathname);
  }

  private async api(req:IncomingMessage,res:ServerResponse,url:URL){
    const p=url.pathname,m=req.method||'GET';
    const read=async(fn:()=>Promise<unknown>)=>this.json(res,200,await fn());
    const mutate=async(role:WebRole,fn:()=>Promise<unknown>)=>{if(!this.requireRole(role)){this.json(res,403,{error:'ROLE_FORBIDDEN'});return;}this.json(res,200,await fn());};
    if(m==='GET'&&p==='/api/web/v1/status')return read(this.handlers.getStatus);
    if(m==='GET'&&p==='/api/web/v1/tunnel')return read(this.handlers.getTunnelStatus);
    if(m==='GET'&&p==='/api/web/v1/library'){
      const raw=await this.handlers.listLocalMedia();const items=Array.isArray(raw)?raw as BrowserMedia[]:[];
      return this.json(res,200,items.map(item=>({...item,url:this.mediaUrl(item.key,'media'),thumbnailUri:this.mediaUrl(item.key,'thumbnail')})));
    }
    if(m==='GET'&&p==='/api/web/v1/cloud/uploads')return read(this.handlers.listCloudUploads);
    if(m==='GET'&&p==='/api/web/v1/backup/health')return read(this.handlers.getBackupHealth);
    if(m==='POST'&&p==='/api/web/v1/library/open')return mutate('admin',this.handlers.openLibrary);
    if(m==='POST'&&p==='/api/web/v1/google-drive/accounts/connect')return mutate('admin',this.handlers.addGoogleAccount);
    if(m==='GET'&&p==='/api/web/v1/google-drive/accounts')return read(this.handlers.listGoogleAccounts);
    let match=/^\/api\/web\/v1\/google-drive\/accounts\/([^/]+)$/.exec(p);if(m==='DELETE'&&match)return mutate('admin',()=>this.handlers.removeGoogleAccount(decodeURIComponent(match![1])));
    if(m==='POST'&&p==='/api/web/v1/cloud/retry')return mutate('member',this.handlers.retryCloud);
    if(m==='GET'&&p==='/api/web/v1/google-photos/accounts')return read(this.handlers.listGooglePhotosAccounts);
    if(m==='POST'&&p==='/api/web/v1/google-photos/accounts/connect'){const b=await this.body(req);if(!['picker','append'].includes(String(b.capability))){this.json(res,400,{error:'INVALID_CAPABILITY'});return;}return mutate('admin',()=>this.handlers.connectGooglePhotosAccount(b.capability));}
    match=/^\/api\/web\/v1\/google-photos\/accounts\/([^/]+)$/.exec(p);if(m==='DELETE'&&match)return mutate('admin',()=>this.handlers.removeGooglePhotosAccount(decodeURIComponent(match![1])));
    if(m==='GET'&&p==='/api/web/v1/migrations')return read(this.handlers.listMigrations);
    if(m==='POST'&&p==='/api/web/v1/migrations'){const b=await this.body(req);return mutate('member',()=>this.handlers.createMigration(b));}
    match=/^\/api\/web\/v1\/migrations\/([^/]+)$/.exec(p);if(m==='GET'&&match)return read(()=>this.handlers.getMigration(decodeURIComponent(match![1])));
    match=/^\/api\/web\/v1\/migrations\/([^/]+)\/(selection|run|pause|resume|cancel|retry)$/.exec(p);if(m==='POST'&&match){const id=decodeURIComponent(match[1]);const op=match[2];return mutate('member',()=>op==='selection'?this.handlers.materializeMigration(id):op==='run'?this.handlers.runMigration(id):op==='pause'?this.handlers.pauseMigration(id):op==='resume'?this.handlers.resumeMigration(id):op==='cancel'?this.handlers.cancelMigration(id):this.handlers.retryMigration(id));}
    match=/^\/api\/web\/v1\/(media|playback|thumbnail)\/([^/]+)$/.exec(p);if(m==='GET'&&match){const variant=match[1]==='media'?'original':match[1] as 'playback'|'thumbnail';await this.handlers.streamMedia(req,res,decodeURIComponent(match[2]),variant);return;}
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
        const bootstrap=`<script>window.__PHOTOSYNC_WEB_CONFIG__={baseUrl:location.origin,accessToken:(sessionStorage.getItem('photox.web.token')||new URLSearchParams(location.hash.slice(1)).get('access_token')||'')};if(window.__PHOTOSYNC_WEB_CONFIG__.accessToken){sessionStorage.setItem('photox.web.token',window.__PHOTOSYNC_WEB_CONFIG__.accessToken);if(location.hash)history.replaceState(null,'',location.pathname+location.search);}</script>`;
        body=Buffer.from(body.toString('utf8').replace('</head>',`${bootstrap}</head>`));
      }
      const ext=path.extname(filePath);const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
      res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','content-length':String(body.length),'cache-control':ext==='.html'?'no-store':'public, max-age=31536000, immutable','content-security-policy':"default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});
      if(req.method==='HEAD')res.end();else res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  }
}
