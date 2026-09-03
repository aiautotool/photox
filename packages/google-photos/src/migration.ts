import type { MigrationTarget, PickedMediaItem } from './index';

export type MigrationJobState = 'draft' | 'selecting' | 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
export type MigrationItemState = 'queued' | 'downloading' | 'uploading' | 'verifying' | 'completed' | 'failed' | 'cancelled';

export interface MigrationTransferCheckpoint {
  kind: 'google_drive_resumable_v1';
  accountId: string;
  sessionUri: string;
  nextByte: number;
  totalBytes: number;
  targetId?: string;
  updatedAt: string;
}

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
  transferRateBps?: number;
  etaSeconds?: number;
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
  getTransferCheckpoint(itemId: string): Promise<MigrationTransferCheckpoint | null>;
  setTransferCheckpoint(itemId: string, checkpoint: MigrationTransferCheckpoint | null): Promise<void>;
}

export interface MigrationTransferAdapter {
  transfer(input: {
    job: GooglePhotosMigrationJob;
    item: GooglePhotosMigrationItem;
    source: PickedMediaItem;
    signal?: AbortSignal;
    onBytes?: (transferredBytes: number) => void;
    checkpoint?: MigrationTransferCheckpoint;
    onCheckpoint?: (checkpoint: MigrationTransferCheckpoint | null) => Promise<void>;
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
  /** Optional defense-in-depth tenant boundary supplied by the caller. */
  workspaceId?: string;
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
    if (control.workspaceId && job.workspaceId !== control.workspaceId) throw new Error('MIGRATION_WORKSPACE_MISMATCH');
    if (job.state === 'completed' || job.state === 'cancelled') return job;

    const startedAt = job.startedAt ?? this.now().toISOString();
    job = (await this.ledger.updateJob(jobId, { state: 'running', startedAt, lastError: undefined, transferRateBps: undefined, etaSeconds: undefined, updatedAt: this.now().toISOString() })) ?? job;
    const items = await this.ledger.listItems(jobId);
    let progressBytes = items.reduce((sum, item) => sum + item.transferredBytes, 0);
    let progressAt = this.now().getTime();
    let smoothedRate = job.transferRateBps ?? 0;

    const updateTelemetry = (nextTotalBytes: number) => {
      const nowMs = this.now().getTime();
      const elapsedSeconds = (nowMs - progressAt) / 1000;
      const deltaBytes = Math.max(0, nextTotalBytes - progressBytes);
      if (elapsedSeconds < 0.25 || deltaBytes <= 0) return;
      const instantRate = deltaBytes / elapsedSeconds;
      smoothedRate = smoothedRate > 0 ? smoothedRate * 0.6 + instantRate * 0.4 : instantRate;
      progressBytes = nextTotalBytes;
      progressAt = nowMs;
      const etaSeconds = job?.totalBytes != null && smoothedRate > 0 ? Math.max(0, (job.totalBytes - nextTotalBytes) / smoothedRate) : undefined;
      void this.ledger.updateJob(jobId, {
        transferredBytes: nextTotalBytes,
        transferRateBps: smoothedRate,
        etaSeconds,
        updatedAt: this.now().toISOString(),
      });
    };

    for (const item of items) {
      if (signal?.aborted || control.shouldCancel()) {
        const updatedAt = this.now().toISOString();
        for (const remaining of items.filter(candidate => candidate.state === 'queued' || candidate.state === 'failed')) {
          await this.ledger.updateItem(remaining.id, { state: 'cancelled', updatedAt });
        }
        return (await this.ledger.updateJob(jobId, { state: 'cancelled', transferRateBps: undefined, etaSeconds: undefined, updatedAt, completedAt: updatedAt })) ?? job;
      }
      if (control.shouldPause()) {
        return (await this.ledger.updateJob(jobId, { state: 'paused', transferRateBps: undefined, etaSeconds: undefined, updatedAt: this.now().toISOString() })) ?? job;
      }
      if (item.state === 'completed' || item.state === 'cancelled') continue;
      const source = sources.get(item.sourceMediaId);
      if (!source) {
        await this.ledger.updateItem(item.id, { state: 'failed', attempts: item.attempts + 1, error: 'PICKER_SOURCE_EXPIRED_OR_MISSING', updatedAt: this.now().toISOString() });
        continue;
      }

      let latest = (await this.ledger.updateItem(item.id, { state: 'downloading', attempts: item.attempts + 1, error: undefined, updatedAt: this.now().toISOString() })) ?? item;
      const otherBytes = items.reduce((sum, candidate) => sum + (candidate.id === item.id ? 0 : candidate.transferredBytes), 0);
      try {
        latest = (await this.ledger.updateItem(item.id, { state: 'uploading', updatedAt: this.now().toISOString() })) ?? latest;
        const checkpoint = await this.ledger.getTransferCheckpoint(item.id) ?? undefined;
        const result = await this.adapter.transfer({
          job,
          item: latest,
          source,
          signal,
          checkpoint,
          onBytes: bytes => {
            const normalized = Math.max(0, Math.floor(bytes));
            void this.ledger.updateItem(item.id, { transferredBytes: normalized, updatedAt: this.now().toISOString() });
            updateTelemetry(otherBytes + normalized);
          },
          onCheckpoint: async nextCheckpoint => { await this.ledger.setTransferCheckpoint(item.id, nextCheckpoint); },
        });
        latest = (await this.ledger.updateItem(item.id, { state: 'verifying', targetId: result.targetId, targetUrl: result.targetUrl, updatedAt: this.now().toISOString() })) ?? latest;
        if (this.adapter.verify) await this.adapter.verify({ job, item: latest, targetId: result.targetId, signal });
        await this.ledger.updateItem(item.id, { state: 'completed', targetId: result.targetId, targetUrl: result.targetUrl, error: undefined, updatedAt: this.now().toISOString() });
        await this.ledger.setTransferCheckpoint(item.id, null);
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
    return (await this.ledger.updateJob(jobId, { state, completedItems, failedItems, transferredBytes, transferRateBps: undefined, etaSeconds: 0, completedAt, updatedAt: completedAt })) ?? job;
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
