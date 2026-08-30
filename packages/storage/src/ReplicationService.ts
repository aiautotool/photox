import type { MediaAsset, StorageReplica } from '@photox/contracts';
import { StoragePolicyEngine, type StoragePolicy } from './StoragePolicyEngine';

export class ReplicationService {
  constructor(private readonly policyEngine:StoragePolicyEngine) {}

  async replicate(asset:MediaAsset, policy?:StoragePolicy):Promise<StorageReplica[]> {
    const replicas=[...(asset.replicas ?? [])];
    let needed=this.policyEngine.replicasNeeded(replicas,policy);
    if(!needed) return replicas;
    const candidates=await this.policyEngine.candidates(asset,replicas,policy);
    for(const {provider,account} of candidates) {
      if(needed<=0) break;
      const pending:StorageReplica={providerId:provider.id,accountId:account.accountId,state:'UPLOADING'};
      replicas.push(pending);
      try {
        const object=await provider.upload({key:asset.id,filename:asset.filename,mimeType:asset.mimeType,sizeBytes:asset.sizeBytes,sha256:asset.sha256 ?? '',accountId:account.accountId,localUri:asset.localUri});
        Object.assign(pending,object,{state:'VERIFIED',uploadedAt:new Date().toISOString(),verifiedAt:new Date().toISOString()});
        needed--;
      } catch(error) {
        pending.state='ERROR';
        pending.message=error instanceof Error?error.message:String(error);
      }
    }
    return replicas;
  }
}
