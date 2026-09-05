import { describe, expect, it } from 'vitest';
import {
  GooglePhotosMigrationRunner,
  type GooglePhotosMigrationItem,
  type GooglePhotosMigrationJob,
  type GooglePhotosMigrationLedger,
  type MigrationTransferCheckpoint,
  type PickedMediaItem,
} from './index';

describe('Google Photos migration restart recovery', () => {
  it('resumes verification from a durable target without re-uploading', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-verify-restart');
    const item = makeItem(job.id, {
      state: 'verifying',
      targetId: 'photos-target-1',
      targetUrl: 'https://photos.example/target-1',
      attempts: 1,
      transferredBytes: 123,
    });
    const checkpoint: MigrationTransferCheckpoint = {
      kind: 'google_drive_resumable_v1',
      accountId: 'destination',
      sessionUri: 'https://upload.example/session',
      nextByte: 123,
      totalBytes: 123,
      targetId: 'photos-target-1',
      updatedAt: '2026-09-05T00:00:00.000Z',
    };
    await ledger.createJob(job);
    await ledger.putItems([item]);
    await ledger.setTransferCheckpoint(item.id, checkpoint);

    let transferCalls = 0;
    let verifyCalls = 0;
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer() {
        transferCalls += 1;
        throw new Error('transfer must not run for an already-created target');
      },
      async verify({ targetId }) {
        verifyCalls += 1;
        expect(targetId).toBe('photos-target-1');
      },
    });

    const result = await runner.run(job.id, new Map(), { shouldPause: () => false, shouldCancel: () => false });
    expect(result.state).toBe('completed');
    expect(transferCalls).toBe(0);
    expect(verifyCalls).toBe(1);
    expect(await ledger.getTransferCheckpoint(item.id)).toBeNull();
    expect((await ledger.listItems(job.id))[0]).toEqual(expect.objectContaining({
      state: 'completed',
      targetId: 'photos-target-1',
      targetUrl: 'https://photos.example/target-1',
      attempts: 1,
    }));
  });

  it('keeps a durable target and checkpoint when restart verification fails, then retries verification only', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-verify-retry');
    const item = makeItem(job.id, {
      state: 'verifying',
      targetId: 'drive-target-1',
      attempts: 2,
      transferredBytes: 64,
    });
    const checkpoint: MigrationTransferCheckpoint = {
      kind: 'google_drive_resumable_v1',
      accountId: 'destination',
      sessionUri: 'https://upload.example/session-2',
      nextByte: 64,
      totalBytes: 64,
      targetId: 'drive-target-1',
      updatedAt: '2026-09-05T00:00:00.000Z',
    };
    await ledger.createJob(job);
    await ledger.putItems([item]);
    await ledger.setTransferCheckpoint(item.id, checkpoint);

    let transferCalls = 0;
    let verifyCalls = 0;
    let failVerification = true;
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer() {
        transferCalls += 1;
        return { targetId: 'duplicate-target' };
      },
      async verify() {
        verifyCalls += 1;
        if (failVerification) throw new Error('provider temporarily unavailable');
      },
    });

    const failed = await runner.run(job.id, new Map(), { shouldPause: () => false, shouldCancel: () => false });
    expect(failed.state).toBe('completed_with_errors');
    expect(transferCalls).toBe(0);
    expect(verifyCalls).toBe(1);
    expect(await ledger.getTransferCheckpoint(item.id)).toEqual(checkpoint);
    expect((await ledger.listItems(job.id))[0]).toEqual(expect.objectContaining({
      state: 'failed',
      targetId: 'drive-target-1',
      attempts: 2,
      error: 'provider temporarily unavailable',
    }));

    failVerification = false;
    const completed = await runner.run(job.id, new Map(), { shouldPause: () => false, shouldCancel: () => false });
    expect(completed.state).toBe('completed');
    expect(transferCalls).toBe(0);
    expect(verifyCalls).toBe(2);
    expect(await ledger.getTransferCheckpoint(item.id)).toBeNull();
    expect((await ledger.listItems(job.id))[0]).toEqual(expect.objectContaining({
      state: 'completed',
      targetId: 'drive-target-1',
      attempts: 2,
      error: undefined,
    }));
  });
});

function makeJob(id: string): GooglePhotosMigrationJob {
  return {
    id,
    workspaceId: 'workspace-1',
    sourceAccountId: 'source',
    sourcePickerSessionId: 'picker-session',
    target: 'google_photos',
    targetAccountId: 'destination',
    state: 'queued',
    totalItems: 1,
    completedItems: 0,
    failedItems: 0,
    transferredBytes: 0,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function makeItem(jobId: string, patch: Partial<GooglePhotosMigrationItem>): GooglePhotosMigrationItem {
  return {
    id: `${jobId}:0:source-1`,
    jobId,
    sourceMediaId: 'source-1',
    filename: 'IMG_0001.JPG',
    mimeType: 'image/jpeg',
    state: 'queued',
    attempts: 0,
    transferredBytes: 0,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...patch,
  };
}

class MemoryLedger implements GooglePhotosMigrationLedger {
  private readonly jobs = new Map<string, GooglePhotosMigrationJob>();
  private readonly items = new Map<string, GooglePhotosMigrationItem>();
  private readonly checkpoints = new Map<string, MigrationTransferCheckpoint>();

  async createJob(job: GooglePhotosMigrationJob) { this.jobs.set(job.id, { ...job }); }
  async getJob(jobId: string) { const job = this.jobs.get(jobId); return job ? { ...job } : null; }
  async listJobs(workspaceId: string) { return [...this.jobs.values()].filter(job => job.workspaceId === workspaceId).map(job => ({ ...job })); }
  async updateJob(jobId: string, patch: Partial<GooglePhotosMigrationJob>) {
    const current = this.jobs.get(jobId); if (!current) return null;
    const next = { ...current, ...patch }; this.jobs.set(jobId, next); return { ...next };
  }
  async putItems(items: GooglePhotosMigrationItem[]) { for (const item of items) this.items.set(item.id, { ...item }); }
  async listItems(jobId: string) { return [...this.items.values()].filter(item => item.jobId === jobId).map(item => ({ ...item })); }
  async updateItem(itemId: string, patch: Partial<GooglePhotosMigrationItem>) {
    const current = this.items.get(itemId); if (!current) return null;
    const next = { ...current, ...patch }; this.items.set(itemId, next); return { ...next };
  }
  async getTransferCheckpoint(itemId: string) { return this.checkpoints.get(itemId) ?? null; }
  async setTransferCheckpoint(itemId: string, checkpoint: MigrationTransferCheckpoint | null) {
    if (checkpoint) this.checkpoints.set(itemId, checkpoint); else this.checkpoints.delete(itemId);
  }
}
