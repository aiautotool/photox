export type IntegrityState = 'UNKNOWN'|'HEALTHY'|'MISSING'|'CORRUPTED'|'UNREADABLE'|'STALE';
export interface IntegrityTarget { assetId:string; providerId:string; accountId:string; remoteFileId:string; expectedSizeBytes?:number; expectedSha256?:string; }
export interface IntegrityProbeResult { exists:boolean; readable:boolean; sizeBytes?:number; sha256?:string; checkedAt:string; }
export interface IntegrityProbe { probe(target:IntegrityTarget):Promise<IntegrityProbeResult>; }
export interface IntegrityReport extends IntegrityTarget { state:IntegrityState; checkedAt:string; sizeMatches?:boolean; checksumMatches?:boolean; message?:string; }
export interface IntegrityReportRepository { save(report:IntegrityReport):Promise<void>; latest(assetId:string,providerId:string,accountId:string,remoteFileId:string):Promise<IntegrityReport|null>; }
export class MemoryIntegrityReportRepository implements IntegrityReportRepository { private rows=new Map<string,IntegrityReport>(); private key(v:IntegrityTarget){return `${v.assetId}:${v.providerId}:${v.accountId}:${v.remoteFileId}`;} async save(r:IntegrityReport){this.rows.set(this.key(r),r);} async latest(a:string,p:string,ac:string,r:string){return this.rows.get(`${a}:${p}:${ac}:${r}`)??null;} }
export class IntegrityVerificationEngine {
  constructor(private readonly probe:IntegrityProbe,private readonly reports:IntegrityReportRepository){}
  async verify(target:IntegrityTarget):Promise<IntegrityReport>{
    const result=await this.probe.probe(target); let state:IntegrityState='HEALTHY'; let message:string|undefined;
    const sizeMatches=target.expectedSizeBytes===undefined||result.sizeBytes===undefined?undefined:target.expectedSizeBytes===result.sizeBytes;
    const checksumMatches=target.expectedSha256===undefined||result.sha256===undefined?undefined:target.expectedSha256.toLowerCase()===result.sha256.toLowerCase();
    if(!result.exists){state='MISSING';message='Remote object not found';} else if(!result.readable){state='UNREADABLE';message='Remote object cannot be read';} else if(sizeMatches===false||checksumMatches===false){state='CORRUPTED';message='Remote object integrity mismatch';}
    const report:IntegrityReport={...target,state,checkedAt:result.checkedAt,sizeMatches,checksumMatches,message}; await this.reports.save(report); return report;
  }
}
export interface RestoreVerifier { download(target:IntegrityTarget):Promise<Uint8Array>; sha256(data:Uint8Array):Promise<string>; }
export class RestoreVerificationService { constructor(private readonly adapter:RestoreVerifier){} async verify(target:IntegrityTarget){const data=await this.adapter.download(target);const hash=await this.adapter.sha256(data);return {ok:!target.expectedSha256||hash.toLowerCase()===target.expectedSha256.toLowerCase(),sha256:hash,sizeBytes:data.byteLength};} }
