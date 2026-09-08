export type MediaIngestIdentity={workspaceId:string;key:string};
export type MediaIngestCommitResult<T>={status:'committed';value:T}|{status:'duplicate'};

type IngestCommitDependencies<T>={
  exists(identity:MediaIngestIdentity):Promise<boolean>;
  commit(identity:MediaIngestIdentity):Promise<T>;
};

function identityKey(identity:MediaIngestIdentity){
  const workspaceId=identity.workspaceId.trim();
  const key=identity.key.trim();
  if(!workspaceId)throw new Error('MEDIA_INGEST_WORKSPACE_REQUIRED');
  if(!key)throw new Error('MEDIA_INGEST_KEY_REQUIRED');
  return `${workspaceId}\u0000${key}`;
}

export function createMediaIngestCommitCoordinator(){
  const tails=new Map<string,Promise<void>>();

  async function run<T>(identity:MediaIngestIdentity,deps:IngestCommitDependencies<T>):Promise<MediaIngestCommitResult<T>>{
    const lockKey=identityKey(identity);
    const previous=tails.get(lockKey)??Promise.resolve();
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve});
    const tail=previous.catch(()=>undefined).then(()=>current);
    tails.set(lockKey,tail);
    await previous.catch(()=>undefined);
    try{
      if(await deps.exists(identity))return {status:'duplicate'};
      return {status:'committed',value:await deps.commit(identity)};
    }finally{
      release();
      if(tails.get(lockKey)===tail)tails.delete(lockKey);
    }
  }

  return {run,pending:()=>tails.size};
}
