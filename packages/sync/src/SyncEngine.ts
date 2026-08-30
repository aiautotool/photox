import type { MediaAsset, SyncJob } from '@photox/contracts';
import { EventBus } from './EventBus';
import { SyncQueue } from './SyncQueue';

export interface SyncProcessor { process(job:SyncJob):Promise<void>; }

export class SyncEngine {
  constructor(readonly queue=new SyncQueue(),readonly events=new EventBus(),private readonly processor?:SyncProcessor) {}
  enqueue(asset:MediaAsset):SyncJob { const now=new Date().toISOString(); const job:SyncJob={id:`sync:${asset.id}`,asset,stage:'discover',state:'queued',attempts:0,createdAt:now,updatedAt:now}; this.queue.enqueue(job); void this.events.emit('sync:queued',job); return job; }
  async runNext():Promise<SyncJob|undefined> { const job=this.queue.next(); if(!job||!this.processor)return job; job.state='running'; job.attempts++; job.updatedAt=new Date().toISOString(); try { await this.processor.process(job); job.stage='complete'; job.state='completed'; await this.events.emit('sync:completed',job); } catch(error) { job.state='failed'; job.error={code:'SYNC_PROCESS_FAILED',message:error instanceof Error?error.message:String(error),retryable:true}; await this.events.emit('sync:failed',job); } job.updatedAt=new Date().toISOString(); return job; }
}
