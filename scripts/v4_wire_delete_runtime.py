# One-shot v4 runtime wiring migration; remove after the generated production commit lands.
from pathlib import Path

p = Path('desktop/electron/main.ts')
s = p.read_text()
old = "import { createMediaIndexRuntimeWriter } from './mediaIndexRuntimeWriter.js';"
new = old + "\nimport { createMediaProviderOperationGate } from './mediaProviderOperationGate.js';"
assert old in s and "mediaProviderOperationGate" not in s
s = s.replace(old, new, 1)
marker = "let cloudUploadQueue: Promise<void> = Promise.resolve();"
assert marker in s
s = s.replace(marker, marker + "\nconst mediaProviderOperationGate=createMediaProviderOperationGate();", 1)
old_upload = "async function uploadLocalToDrive(row:MediaIndexRow){"
assert old_upload in s
s = s.replace(old_upload, "async function uploadLocalToDrive(row:MediaIndexRow){return mediaProviderOperationGate.run(row.workspaceId,row.key,()=>uploadLocalToDriveUnlocked(row));}\n\nasync function uploadLocalToDriveUnlocked(row:MediaIndexRow){", 1)

start = s.index("async function deleteManagedMedia(key:string,workspaceId=LEGACY_WORKSPACE_ID){")
end = s.index("\nasync function fetchCloudMedia", start)
replacement = """async function deleteManagedMedia(key:string,workspaceId=LEGACY_WORKSPACE_ID){
  return mediaProviderOperationGate.run(workspaceId,key,async()=>{
    const writer=mediaIndexWriter();
    const requestedClaimId=crypto.randomUUID();
    const claimed=await writer.claimDeletion(workspaceId,key,requestedClaimId);
    if(!claimed)throw new Error('MEDIA_NOT_FOUND');
    // A tombstone left by an interrupted delete is resumable. Inside the exact
    // provider-operation gate there cannot be another live upload/delete for the
    // same workspace + media identity, so continuing the prior claim is safe.
    const claimId=claimed.deletion?.claimId||requestedClaimId;
    const row=claimed as MediaIndexRow;
    const accounts=new Map((await savedDriveAccounts(workspaceId)).map(account=>[account.id,account]));const failures:string[]=[];
    for(const replica of replicasOf(row).filter(replica=>replica.remoteFileId)){
      if(!replica.accountId){failures.push('Replica thiếu accountId');continue;}
      const account=accounts.get(replica.accountId);if(!account){failures.push(`Không còn thông tin tài khoản ${replica.accountId}`);continue;}
      try{
        const client=oauthClient();client.setCredentials(account.tokens as any);const token=await client.getAccessToken();if(!token.token)throw new Error('Không lấy được access token');
        const response=await net.fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(replica.remoteFileId!)}`,{method:'DELETE',headers:{authorization:`Bearer ${token.token}`}});
        if(!response.ok&&response.status!==404)throw new Error(`Drive ${response.status}: ${await response.text()}`);
      }catch(error){failures.push(`${replica.accountEmail||replica.accountId}: ${error instanceof Error?error.message:String(error)}`)}
    }
    if(failures.length)throw new Error(`Không xóa hết replica cloud: ${failures.join(' | ')}`);
    for(const filePath of [row.thumbnailPath,row.playbackPath,row.path])if(filePath)await fs.unlink(filePath).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error});
    const removed=await writer.removeClaimed(workspaceId,key,claimId);
    if(!removed)throw new Error('MEDIA_DELETE_CLAIM_LOST');
    const repo=requireWorkspaceRepository();repo.releaseMediaReservation(workspaceId,row.size,{releaseManaged:true,releaseIngress:false});
    repo.appendAudit({workspaceId,actorUserId:LEGACY_OWNER_USER_ID,actorDeviceId:LEGACY_DESKTOP_DEVICE_ID,action:'media.delete',targetType:'media',targetId:key,metadata:{filename:row.filename,size:row.size,claimId}});
    notifyRenderer('photosync:media-deleted',{key,filename:row.filename});return {deleted:true,key,filename:row.filename};
  });
}
"""
s = s[:start] + replacement + s[end:]
p.write_text(s)

t = Path('desktop/electron/mediaIndexRuntimeWiring.test.ts')
q = t.read_text()
needle = "  assert.doesNotMatch(source, /await updateIndexRow\\(key,\\{videoProcessing:/);"
assert needle in q
q = q.replace(needle, needle + "\n  assert.match(source, /createMediaProviderOperationGate\\(\\)/);\n  assert.match(source, /mediaProviderOperationGate\\.run\\(row\\.workspaceId,row\\.key,/);\n  assert.match(source, /writer\\.claimDeletion\\(workspaceId,key,requestedClaimId\\)/);\n  assert.match(source, /writer\\.removeClaimed\\(workspaceId,key,claimId\\)/);\n  assert.doesNotMatch(source, /rows\\.splice\\(index,1\\);await writeIndex\\(rows,workspaceId\\)/);")
t.write_text(q)
