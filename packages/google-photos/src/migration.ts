import type { MigrationTarget, PickedMediaItem } from './index';

export type MigrationJobState = 'draft' | 'selecting' | 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
export type MigrationItemState = 'queued' | 'downloading' | 'uploading' | 'verifying' | 'completed' | 'failed' | 'cancelled';

export interface GooglePhotosMigrationJob {
  id: string;
  workspaceId: string;
  sourceAccountId: string;
  sourcePickerSessionId?: string;
  target: MigrationTarget;
  targetAccountId: string;
  state: MigrationJobState;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  totalBytes?: number;
  transferredBytes: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface GooglePhotosMigrationItem {
  id: string;
  jobId: string;
  sourceMediaId: string;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  state: MigrationItemState;
  attempts: number;
  transferredBytes: number;
  targetId?: string;
  targetUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GooglePhotosMigrationLedger {
  createJob(job: GooglePhotosMigrationJob): Promise<void>;
  getJob(jobId: string): Promise<GooglePhotosMigrationJob | null>;
  listJobs(workspaceId: string): Promise<GooglePhotosMigrationJob[]>;
  updateJob(jobId: string, patch: Partial<Omit<GooglePhotosMigrationJob, 'id' | 'workspaceId' | 'createdAt'>>): Promise<GooglePhotosMigrationJob | null>;
  putItems(items: GooglePhotosMigrationItem[]): Promise<void>;
  listItems(jobId: string): Promise<GooglePhotosMigrationItem[]>;
  updateItem(itemId: string, patch: Partial<Omit<GooglePhotosMigrationItem, 'id' | 'jobId' | 'sourceMediaId' | 'createdAt'>>): Promise<GooglePhotosMigrationItem | null>;
}

export interface MigrationTransferAdapter {
  transfer(input: {
    job: GooglePhotosMigrationJob;
    item: GooglePhotosMigrationItem;
    source: PickedMediaItem;
    signal?: AbortSignal;
    onBytes?: (transferredBytes: number) => void;
  }): Promise<{ targetId?: string; targetUrl?: string }>;
  verify?(input: {
    job: GooglePhotosMigrationJob;
    item: GooglePhotosMigrationItem;
    targetId?: string;
    signal?: AbortSignal;
  }): Promise<void>;
}

export interface MigrationRunControl {
  shouldPause(): boolean;
  shouldCancel(): boolean;
}

export class GooglePhotosMigrationRunner {
  constructor(
    private readonly ledger: GooglePhotosMigrationLedger,
    private readonly adapter: MigrationTransferAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run(jobId: string, sources: Map<string, PickedMediaItem>, control: MigrationRunControl, signal?: AbortSignal) {
    let job = await this.ledger.getJob(jobId);
    if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
    if (job.state === 'completed' || job.state === 'cancelled') return job;

    const startedAt = job.startedAt ?? this.now().toISOString();
    job = (await this.ledger.updateJob(jobId, { state: 'running', startedAt, lastError: undefined, updatedAt: this.now().toISOString() })) ?? job;
    const items = await this.ledger.listItems(jobId);

    for (const item of items) {
      if (signal?.aborted || control.shouldCancel()) {
        const updatedAt = this.now().toISOString();
        for (const remaining of items.filter(candidate => candidate.state === 'queued' || candidate.state === 'failed')) {
          await this.ledger.updateItem(remaining.id, { state: 'cancelled', updatedAt });
        }
        return (await this.ledger.updateJob(jobId, { state: 'cancelled', updatedAt, completedAt: updatedAt })) ?? job;
      }
      if (control.shouldPause()) {
        return (await this.ledger.updateJob(jobId, { state: 'paused', updatedAt: this.now().toISOString() })) ?? job;
      }
      if (item.state === 'completed' || item.state === 'cancelled') continue;
      const source = sources.get(item.sourceMediaId);
      if (!source) {
        await this.ledger.updateItem(item.id, { state: 'failed', attempts: item.attempts + 1, error: 'PICKER_SOURCE_EXPIRED_OR_MISSING', updatedAt: this.now().toISOString() });
        continue;
      }

      let latest = (await this.ledger.updateItem(item.id, { state: 'downloading', attempts: item.attempts + 1, error: undefined, updatedAt: this.now().toISOString() })) ?? item;
      try {
        latest = (await this.ledger.updateItem(item.id, { state: 'uploading', updatedAt: this.now().toISOString() })) ?? latest;
        const result = await this.adapter.transfer({
          job,
          item: latest,
          source,
          signal,
          onBytes: bytes => { void this.ledger.updateItem(item.id, { transferredBytes: Math.max(0, Math.floor(bytes)), updatedAt: this.now().toISOString() }); },
        });
        latest = (await this.ledger.updateItem(item.id, { state: 'verifying', targetId: result.targetId, targetUrl: result.targetUrl, updatedAt: this.now().toISOString() })) ?? latest;
        if (this.adapter.verify) await this.adapter.verify({ job, item: latest, targetId: result.targetId, signal });
        await this.ledger.updateItem(item.id, { state: 'completed', targetId: result.targetId, targetUrl: result.targetUrl, error: undefined, updatedAt: this.now().toISOString() });
      } catch (error) {
        await this.ledger.updateItem(item.id, { state: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: this.now().toISOString() });
      }
    }

    const finalItems = await this.ledger.listItems(jobId);
    const completedItems = finalItems.filter(item => item.state === 'completed').length;
    const failedItems = finalItems.filter(item => item.state === 'failed').length;
    const transferredBytes = finalItems.reduce((sum, item) => sum + item.transferredBytes, 0);
    const state: MigrationJobState = failedItems ? 'completed_with_errors' : 'completed';
    const completedAt = this.now().toISOString();
    return (await this.ledger.updateJob(jobId, { state, completedItems, failedItems, transferredBytes, completedAt, updatedAt: completedAt })) ?? job;
  }
}

export function migrationItemsFromPicker(jobId: string, items: PickedMediaItem[], now = new Date()): GooglePhotosMigrationItem[] {
  const createdAt = now.toISOString();
  return items.map((item, index) => ({
    id: `${jobId}:${index}:${item.id}`,
    jobId,
    sourceMediaId: item.id,
    filename: item.mediaFile?.filename || `google-photo-${index + 1}`,
    mimeType: item.mediaFile?.mimeType,
    state: 'queued',
    attempts: 0,
    transferredBytes: 0,
    createdAt,
    updatedAt: createdAt,
  }));
}
