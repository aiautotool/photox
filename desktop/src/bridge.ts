export type LocalMedia = { key:string;name:string;path:string;url:string;modifiedAt:string;sourceDevice?:string;size:number;receivedAt:string;sha256:string;localAvailable:boolean;cloudAvailable:boolean };
export type CloudState = 'QUEUED'|'UPLOADING'|'VERIFYING'|'VERIFIED'|'UPLOADED'|'BLOCKED'|'ERROR';
export type CloudUpload = { key:string;filename:string;size:number;receivedAt:string;deviceId:string;state:CloudState;accountId?:string;accountEmail?:string;folderId?:string;remotePath?:string;remoteFileId?:string;webViewLink?:string;uploadedAt?:string;verifiedAt?:string;message?:string };
export type DesktopStatus = { state:'idle'|'receiving'|'uploading'|'error'; received:number; duplicates:number; cloudUploaded:number; cloudBlocked:number; message?:string; receiverUrl?:string; publicUrl?:string; tunnelHealthy?:boolean; pairCode?:string; libraryPath?:string; driveAccounts?:number; lastRunAt?:string };
export type TunnelState = { connected:boolean; relayUrl:string; desktopId:string; pairingPayload:string; lastError?:string };
export type DriveAccount = { id:string;email:string;usedBytes:number;freeBytes:number;totalBytes:number;status:'ready'|'unavailable' };
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
  onFileReceived(cb:(event:{name:string;path:string})=>void):()=>void;
  onStorageUpdated(cb:(event:unknown)=>void):()=>void;
  onTunnelState(cb:(event:TunnelState)=>void):()=>void;
}

declare global { interface Window { photoSyncDesktop?:DesktopBridge; __PHOTOSYNC_WEB_CONFIG__?: Partial<WebBridgeConfig> } }

export interface WebBridgeConfig {
  baseUrl: string;
  accessToken: string;
  websocketUrl?: string;
}

function normalizeBaseUrl(value:string){return value.replace(/\/$/,'')}

export function resolveDesktopBridge(): DesktopBridge | undefined {
  if (window.photoSyncDesktop) return window.photoSyncDesktop;
  const config=window.__PHOTOSYNC_WEB_CONFIG__;
  if (!config?.baseUrl || !config.accessToken) return undefined;
  return createHttpDesktopBridge({baseUrl:config.baseUrl,accessToken:config.accessToken,websocketUrl:config.websocketUrl});
}

export function createHttpDesktopBridge(config:WebBridgeConfig):DesktopBridge {
  const baseUrl=normalizeBaseUrl(config.baseUrl);
  const headers=()=>({authorization:`Bearer ${config.accessToken}`});
  async function json<T>(path:string,init:RequestInit={}):Promise<T>{
    const response=await fetch(`${baseUrl}${path}`,{...init,headers:{...headers(),...(init.body?{'content-type':'application/json'}:{}),...(init.headers||{})}});
    if(!response.ok)throw new Error(`PhotoX Web API ${response.status}: ${await response.text()}`);
    if(response.status===204)return undefined as T;
    return response.json() as Promise<T>;
  }
  function subscribe(eventName:string,callback:(payload:any)=>void){
    const wsUrl=config.websocketUrl||baseUrl.replace(/^http:/,'ws:').replace(/^https:/,'wss:')+'/api/web/v1/events';
    const socket=new WebSocket(wsUrl,['photox-v1',config.accessToken]);
    const handler=(event:MessageEvent)=>{try{const data=JSON.parse(String(event.data));if(data?.event===eventName)callback(data.payload)}catch{}};
    socket.addEventListener('message',handler);
    return()=>{socket.removeEventListener('message',handler);socket.close()};
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
    onFileReceived:(cb)=>subscribe('file-received',cb),
    onStorageUpdated:(cb)=>subscribe('storage-updated',cb),
    onTunnelState:(cb)=>subscribe('tunnel-state',cb),
  };
}
