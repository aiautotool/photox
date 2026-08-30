import type { UpdateArch, UpdateArtifact, UpdateChannel, UpdateManifest, UpdatePlatform } from '@photox/contracts';
const parts=(v:string)=>v.replace(/^v/,'').split(/[.+-]/).slice(0,3).map(x=>Number.parseInt(x,10)||0);
export const compareVersions=(a:string,b:string):number=>{const aa=parts(a),bb=parts(b); for(let i=0;i<3;i++){if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;} return 0;};
export interface UpdateCheck { available:boolean; required:boolean; manifest:UpdateManifest; artifact?:UpdateArtifact; }
export class UpdateClient {
  constructor(private readonly manifestUrl:string,private readonly fetcher:typeof fetch=fetch) {}
  async check(currentVersion:string,platform:UpdatePlatform,arch?:UpdateArch,channel:UpdateChannel='stable'):Promise<UpdateCheck>{ const r=await this.fetcher(this.manifestUrl,{headers:{'cache-control':'no-cache'}}); if(!r.ok)throw new Error(`Update manifest HTTP ${r.status}`); const m=await r.json() as UpdateManifest; if(m.schemaVersion!==1||m.app!=='photox')throw new Error('Unsupported PhotoX update manifest'); const available=m.channel===channel&&compareVersions(m.version,currentVersion)>0; const required=Boolean(m.minimumSupportedVersion&&compareVersions(currentVersion,m.minimumSupportedVersion)<0); const artifact=m.artifacts.find(a=>a.platform===platform&&(!arch||!a.arch||a.arch===arch||a.arch==='universal')); return {available,required,manifest:m,artifact}; }
}
