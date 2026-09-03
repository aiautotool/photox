export type LocalMedia = { key:string;name:string;path:string;url:string;modifiedAt:string;sourceDevice?:string;size:number;receivedAt:string;sha256:string;localAvailable:boolean;cloudAvailable:boolean };
export type CloudState = 'QUEUED'|'UPLOADING'|'VERIFYING'|'VERIFIED'|'UPLOADED'|'BLOCKED'|'ERROR';
export type CloudUpload = { key:string;filename:string;size:number;receivedAt:string;deviceId:string;state:CloudState;accountId?:string;accountEmail?:string;folderId?:string;remotePath?:string;remoteFileId?:string;webViewLink?:string;uploadedAt?:string;verifiedAt?:string;message?:string };
export type DesktopStatus = { state:'idle'|'receiving'|'uploading'|'error'; received:number; duplicates:number; cloudUploaded:number; cloudBlocked:number; message?:string; receiverUrl?:string; publicUrl?:string; tunnelHealthy?:boolean; pairCode?:string; libraryPath?:string; driveAccounts?:number; lastRunAt?:string };
export type TunnelState = { connected:boolean; relayUrl:string; desktopId:string; pairingPayload:string; lastError?:string };
export type DriveAccount = { id:string;email:string;usedBytes:number;freeBytes:number;totalBytes:number;status:'ready'|'unavailable' };
export type GooglePhotosAccount={id:string;email:string;capabilities:('picker'|'append')[];status:'ready'|'unavailable'};
export type MigrationJob={id:string;workspaceId:string;sourceAccountId:string;sourcePickerSessionId?:string;target:'google_photos'|'google_drive';targetAccountId:string;state:string;totalItems:number;completedItems:number;failedItems:number;totalBytes?:number;transferredBytes:number;createdAt:string;updatedAt:string;startedAt?:string;completedAt?:string;lastError?:string};
export type MigrationItem={id:string;jobId:string;sourceMediaId:string;filename:string;mimeType?:string;sizeBytes?:number;state:string;attempts:number;transferredBytes:number;targetId?:string;targetUrl?:string;error?:string;createdAt:string;updatedAt:string};
export type MigrationSnapshot={job:MigrationJob;items:MigrationItem[]};
export type BackupHealthSnapshot = {total:number;safe:number;atRisk:number;critical:number;unknown:number;photos:number;videos:number;totalBytes:number;problems:{key:string;filename:string;health:'at_risk'|'critical'|'unknown';reason:string}[]};

export interface DesktopBridge {
  platform:string;
  getStatus():Promise<DesktopStatus>;
  getTunnelStatus():Promise<TunnelState>;
  listLocalMedia():Promise<LocalMedia[]>;
  listCloudUploads():Promise<CloudUpload[]>;
  getBackupHealth():Promise<BackupHealthSnapshot>;
  openLibrary():Promise<void>;
  openExternal(url:string):Promise<void>;
  addGoogleAccount():Promise<DesktopStatus>;
  listGoogleAccounts():Promise<DriveAccount[]>;
  removeGoogleAccount(accountId:string):Promise<DesktopStatus>;
  retryCloud():Promise<DesktopStatus>;
  createWebLoginLink():Promise<{url:string;expiresAt:number}>;
  listGooglePhotosAccounts():Promise<GooglePhotosAccount[]>;
  connectGooglePhotosAccount(capability:'picker'|'append'):Promise<GooglePhotosAccount>;
  removeGooglePhotosAccount(accountId:string):Promise<void>;
  listMigrations():Promise<MigrationJob[]>;
  getMigration(jobId:string):Promise<MigrationSnapshot>;
  createMigration(input:{sourceAccountId:string;target:'google_photos'|'google_drive';targetAccountId:string;maxItemCount?:number}):Promise<{job:MigrationJob;pickerUri:string;expireTime?:string}>;
  materializeMigration(jobId:string):Promise<MigrationSnapshot>;
  runMigration(jobId:string):Promise<MigrationJob>;
  pauseMigration(jobId:string):Promise<MigrationSnapshot>;
  resumeMigration(jobId:string):Promise<MigrationJob>;
  cancelMigration(jobId:string):Promise<MigrationSnapshot>;
  retryMigration(jobId:string):Promise<MigrationJob>;
  onMigrationUpdated(cb:(event:MigrationSnapshot)=>void):()=>void;
  onFileReceived(cb:(event:{name:string;path:string})=>void):()=>void;
  onStorageUpdated(cb:(event:unknown)=>void):()=>void;
  onTunnelState(cb:(event:TunnelState)=>void):()=>void;
}

declare global { interface Window { photoSyncDesktop?:DesktopBridge; __PHOTOSYNC_WEB_CONFIG__?: Partial<WebBridgeConfig> } }

export interface WebBridgeConfig {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  loginTicket?: string;
  websocketUrl?: string;
}

function normalizeBaseUrl(value:string){return value.replace(/\/$/,'')}

export function resolveDesktopBridge(): DesktopBridge | undefined {
  if (window.photoSyncDesktop) return window.photoSyncDesktop;
  const config=window.__PHOTOSYNC_WEB_CONFIG__;
  if (!config?.baseUrl) return undefined;
  return createHttpDesktopBridge({baseUrl:config.baseUrl,accessToken:config.accessToken,refreshToken:config.refreshToken,loginTicket:config.loginTicket,websocketUrl:config.websocketUrl});
}

export function createHttpDesktopBridge(config:WebBridgeConfig):DesktopBridge {
  const baseUrl=normalizeBaseUrl(config.baseUrl);
  let accessToken=config.accessToken||'';
  let bootstrapRefreshToken=config.refreshToken||'';
  let loginTicket=config.loginTicket||'';
  let csrfToken='';
  let refreshPromise:Promise<boolean>|null=null;
  let bootstrapPromise:Promise<boolean>|null=null;

  function cookie(name:string){
    if(typeof document==='undefined')return '';
    const prefix=`${encodeURIComponent(name)}=`;
    return document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix))?.slice(prefix.length)||'';
  }
  csrfToken=decodeURIComponent(cookie('photox_csrf')||'');

  function persistAccess(){
    if(typeof sessionStorage==='undefined')return;
    if(accessToken)sessionStorage.setItem('photox.web.access',accessToken);else sessionStorage.removeItem('photox.web.access');
  }

  async function bootstrapSession(){
    if(!loginTicket&&!bootstrapRefreshToken)return false;
    if(bootstrapPromise)return bootstrapPromise;
    bootstrapPromise=(async()=>{
      try{
        const ticket=loginTicket;loginTicket='';
        const token=bootstrapRefreshToken;bootstrapRefreshToken='';
        const response=await fetch(`${baseUrl}${ticket?'/api/web/v1/auth/ticket':'/api/web/v1/auth/bootstrap'}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(ticket?{ticket}:{refreshToken:token})});
        if(!response.ok)throw new Error('WEB_BOOTSTRAP_REJECTED');
        const next=await response.json() as {accessToken?:string;csrfToken?:string};
        if(!next.accessToken)throw new Error('WEB_BOOTSTRAP_ACCESS_MISSING');
        accessToken=next.accessToken;csrfToken=next.csrfToken||decodeURIComponent(cookie('photox_csrf')||'');persistAccess();return true;
      }catch{accessToken='';persistAccess();return false;}
      finally{bootstrapPromise=null;}
    })();
    return bootstrapPromise;
  }

  async function refreshAccess(){
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      try{
        if(!csrfToken)csrfToken=decodeURIComponent(cookie('photox_csrf')||'');
        const response=await fetch(`${baseUrl}/api/web/v1/auth/refresh`,{method:'POST',credentials:'include',headers:csrfToken?{'x-csrf-token':csrfToken}:{}});
        if(!response.ok)throw new Error('WEB_REFRESH_REJECTED');
        const next=await response.json() as {accessToken?:string;csrfToken?:string};
        if(!next.accessToken)throw new Error('WEB_REFRESH_TOKEN_MISSING');
        accessToken=next.accessToken;csrfToken=next.csrfToken||csrfToken||decodeURIComponent(cookie('photox_csrf')||'');persistAccess();return true;
      }catch{accessToken='';persistAccess();return false;}
      finally{refreshPromise=null;}
    })();
    return refreshPromise;
  }

  async function json<T>(path:string,init:RequestInit={},retry=true):Promise<T>{
    if(!accessToken&&(loginTicket||bootstrapRefreshToken))await bootstrapSession();
    if(!accessToken)await refreshAccess();
    const method=String(init.method||'GET').toUpperCase();
    if(!csrfToken)csrfToken=decodeURIComponent(cookie('photox_csrf')||'');
    const response=await fetch(`${baseUrl}${path}`,{...init,credentials:'include',headers:{...(accessToken?{authorization:`Bearer ${accessToken}`}:{ }),...(method!=='GET'&&method!=='HEAD'&&csrfToken?{'x-csrf-token':csrfToken}:{}),...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}});
    if(response.status===401&&retry&&await refreshAccess())return json<T>(path,init,false);
    if(!response.ok)throw new Error(`PhotoX Web API ${response.status}: ${await response.text()}`);
    if(response.status===204)return undefined as T;
    return response.json() as Promise<T>;
  }

  function subscribe(eventName:string,callback:(payload:any)=>void){
    let socket:WebSocket|undefined;let stopped=false;let retryTimer:number|undefined;let retryAttempt=0;
    const wsUrl=config.websocketUrl||baseUrl.replace(/^http:/,'ws:').replace(/^https:/,'wss:')+'/api/web/v1/events';
    const scheduleReconnect=(refreshBeforeConnect:boolean)=>{
      if(stopped)return;
      if(retryTimer!==undefined)window.clearTimeout(retryTimer);
      const delay=Math.min(30000,1500*(2**Math.min(retryAttempt,4)));
      retryAttempt+=1;
      retryTimer=window.setTimeout(()=>{retryTimer=undefined;void connect(refreshBeforeConnect)},delay);
    };
    const connect=async(refreshBeforeConnect=false)=>{
      if(stopped)return;
      if(refreshBeforeConnect&&!(await refreshAccess())){scheduleReconnect(true);return;}
      if(!accessToken&&(loginTicket||bootstrapRefreshToken))await bootstrapSession();
      if(!accessToken&&!(await refreshAccess())){scheduleReconnect(false);return;}
      if(stopped||!accessToken)return;
      socket=new WebSocket(wsUrl,['photox-v2',accessToken]);
      socket.addEventListener('open',()=>{retryAttempt=0;});
      socket.addEventListener('message',(event:MessageEvent)=>{try{const data=JSON.parse(String(event.data));if(data?.event===eventName)callback(data.payload)}catch{}});
      socket.addEventListener('close',()=>{socket=undefined;scheduleReconnect(true);});
    };
    void connect();
    return()=>{stopped=true;if(retryTimer!==undefined)window.clearTimeout(retryTimer);socket?.close();};
  }

  return {
    platform:'web',
    getStatus:()=>json('/api/web/v1/status'),
    getTunnelStatus:()=>json('/api/web/v1/tunnel'),
    listLocalMedia:()=>json('/api/web/v1/library'),
    listCloudUploads:()=>json('/api/web/v1/cloud/uploads'),
    getBackupHealth:()=>json('/api/web/v1/backup/health'),
    openLibrary:async()=>{await json('/api/web/v1/library/open',{method:'POST'});},
    openExternal:async(url)=>{const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('WEB_EXTERNAL_URL_REJECTED');window.open(parsed.toString(),'_blank','noopener,noreferrer');},
    addGoogleAccount:()=>json('/api/web/v1/google-drive/accounts/connect',{method:'POST'}),
    listGoogleAccounts:()=>json('/api/web/v1/google-drive/accounts'),
    removeGoogleAccount:(accountId)=>json(`/api/web/v1/google-drive/accounts/${encodeURIComponent(accountId)}`,{method:'DELETE'}),
    retryCloud:()=>json('/api/web/v1/cloud/retry',{method:'POST'}),
    createWebLoginLink:async()=>{throw new Error('WEB_LOGIN_LINK_DESKTOP_ONLY');},
    listGooglePhotosAccounts:()=>json('/api/web/v1/google-photos/accounts'),
    connectGooglePhotosAccount:(capability)=>json('/api/web/v1/google-photos/accounts/connect',{method:'POST',body:JSON.stringify({capability})}),
    removeGooglePhotosAccount:async(accountId)=>{await json(`/api/web/v1/google-photos/accounts/${encodeURIComponent(accountId)}`,{method:'DELETE'});},
    listMigrations:()=>json('/api/web/v1/migrations'),
    getMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}`),
    createMigration:(input)=>json('/api/web/v1/migrations',{method:'POST',body:JSON.stringify(input)}),
    materializeMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/selection`,{method:'POST'}),
    runMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/run`,{method:'POST'}),
    pauseMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/pause`,{method:'POST'}),
    resumeMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/resume`,{method:'POST'}),
    cancelMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/cancel`,{method:'POST'}),
    retryMigration:(jobId)=>json(`/api/web/v1/migrations/${encodeURIComponent(jobId)}/retry`,{method:'POST'}),
    onMigrationUpdated:(cb)=>subscribe('migration-updated',cb),
    onFileReceived:(cb)=>subscribe('file-received',cb),
    onStorageUpdated:(cb)=>subscribe('storage-updated',cb),
    onTunnelState:(cb)=>subscribe('tunnel-state',cb),
  };
}
