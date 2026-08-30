import type { MediaAsset } from '../media/MediaAsset';

export type SyncJobState = 'queued'|'running'|'paused'|'completed'|'failed'|'cancelled';
export type SyncStage = 'discover'|'transfer'|'index'|'replicate'|'verify'|'complete';

export interface SyncError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface SyncJob {
  id: string;
  asset: MediaAsset;
  stage: SyncStage;
  state: SyncJobState;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  error?: SyncError;
}

export type SyncEvent =
  | { type:'sync:queued'; job:SyncJob }
  | { type:'sync:progress'; jobId:string; stage:SyncStage; progress:number }
  | { type:'sync:completed'; job:SyncJob }
  | { type:'sync:failed'; job:SyncJob; error:SyncError };
