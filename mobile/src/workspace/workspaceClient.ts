import { accessHeaders, ensureWorkspaceAccess, type PairedDesktop } from '../sync/pairing';

export type WorkspaceRole = 'owner'|'admin'|'member'|'viewer';
export type WorkspaceEntitlements = {
  maxManagedStorageBytes:number|null;
  maxMonthlyIngressBytes:number|null;
  maxMembers:number|null;
  maxDevices:number|null;
  maxStorageProviders:number|null;
  maxPublicShares:number|null;
  targetOriginalReplicas:number;
  publicSharing:boolean;
  remoteAccess:boolean;
  semanticSearch:boolean;
  priorityVideoProcessing:boolean;
};
export type WorkspaceUsage = {
  managedStorageBytes:number;
  monthlyIngressBytes:number;
  members:number;
  devices:number;
  storageProviders:number;
  publicShares:number;
};
export type WorkspaceQuotaDimension = { current:number; limit:number|null; remaining:number|null; percent:number|null };
export type WorkspaceOverviewSnapshot = {
  workspace:{id:string;name:string;ownerUserId:string;plan:string;status:string};
  membership:{userId:string;role:WorkspaceRole;status:string;joinedAt:number};
  usage:WorkspaceUsage;
  entitlements:WorkspaceEntitlements;
  quota:{
    managedStorage:WorkspaceQuotaDimension;
    monthlyIngress:WorkspaceQuotaDimension;
    members:WorkspaceQuotaDimension;
    devices:WorkspaceQuotaDimension;
    storageProviders:WorkspaceQuotaDimension;
    publicShares:WorkspaceQuotaDimension;
  };
};
export type WorkspaceDevice = {
  id:string;
  workspaceId:string;
  userId:string;
  name:string;
  platform:'ios'|'android'|'windows'|'macos'|'linux'|'web'|'unknown';
  kind:'desktop'|'mobile'|'web'|'service';
  createdAt:number;
  lastSeenAt?:number;
  revokedAt?:number;
};
export type MobileWorkspaceSnapshot = { overview:WorkspaceOverviewSnapshot; devices:WorkspaceDevice[]; devicesError?:string };

function apiCandidates(target:PairedDesktop){
  return [...new Set([target.publicUrl,target.receiverUrl].filter((value):value is string=>Boolean(value)).map(value=>value.replace(/\/$/,'')))];
}

async function requestJson<T>(target:PairedDesktop,path:string):Promise<T>{
  if(target.v!==2||!target.workspaceId)throw new Error('WORKSPACE_SESSION_REQUIRED');
  await ensureWorkspaceAccess(target);
  const bases=apiCandidates(target);
  if(!bases.length)throw new Error('WORKSPACE_API_UNAVAILABLE');
  let lastError='WORKSPACE_API_UNAVAILABLE';
  for(const base of bases){
    try{
      const response=await fetch(`${base}${path}`,{headers:{accept:'application/json',...accessHeaders(target)}});
      if(response.status===401){
        await ensureWorkspaceAccess({...target,accessToken:undefined,accessExpiresAt:undefined});
      }
      if(!response.ok){lastError=`${response.status}:${await response.text().catch(()=> '')}`;continue;}
      return response.json() as Promise<T>;
    }catch(error){lastError=error instanceof Error?error.message:String(error);}
  }
  throw new Error(lastError);
}

export async function loadMobileWorkspaceSnapshot(target:PairedDesktop):Promise<MobileWorkspaceSnapshot>{
  const overview=await requestJson<WorkspaceOverviewSnapshot>(target,'/api/web/v1/workspace');
  try{
    const devices=await requestJson<WorkspaceDevice[]>(target,'/api/web/v1/devices');
    return {overview,devices:devices.filter(device=>device.workspaceId===overview.workspace.id&&!device.revokedAt)};
  }catch(error){
    return {overview,devices:[],devicesError:error instanceof Error?error.message:String(error)};
  }
}

export function quotaSeverity(dimension:WorkspaceQuotaDimension):'normal'|'warning'|'critical'|'unlimited'{
  if(dimension.limit===null||dimension.percent===null)return 'unlimited';
  if(dimension.percent>=90)return 'critical';
  if(dimension.percent>=75)return 'warning';
  return 'normal';
}
