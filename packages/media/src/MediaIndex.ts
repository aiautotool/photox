import type { MediaAsset } from '@photox/contracts';

export class MediaIndex {
  private readonly byId=new Map<string,MediaAsset>();
  private readonly byHash=new Map<string,string>();
  upsert(asset:MediaAsset):void { this.byId.set(asset.id,asset); if(asset.sha256)this.byHash.set(asset.sha256,asset.id); }
  get(id:string):MediaAsset|undefined { return this.byId.get(id); }
  findByHash(sha256:string):MediaAsset|undefined { const id=this.byHash.get(sha256); return id?this.byId.get(id):undefined; }
  list():MediaAsset[] { return [...this.byId.values()]; }
  remove(id:string):boolean { const asset=this.byId.get(id); if(asset?.sha256)this.byHash.delete(asset.sha256); return this.byId.delete(id); }
}
