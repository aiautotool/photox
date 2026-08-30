import type { SyncJob } from '@photox/contracts';

export class SyncQueue {
  private readonly jobs:SyncJob[]=[];
  enqueue(job:SyncJob):void { if(!this.jobs.some(x=>x.id===job.id)) this.jobs.push(job); }
  next():SyncJob|undefined { return this.jobs.find(j=>j.state==='queued'); }
  list():readonly SyncJob[] { return this.jobs; }
  get(id:string):SyncJob|undefined { return this.jobs.find(j=>j.id===id); }
  remove(id:string):boolean { const i=this.jobs.findIndex(j=>j.id===id); if(i<0)return false; this.jobs.splice(i,1); return true; }
}
