import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  GooglePhotosMigrationItem,
  GooglePhotosMigrationJob,
  GooglePhotosMigrationLedger,
  MigrationTransferCheckpoint,
} from '@photosync/google-photos';
import { googlePhotosMigrationAcceptance } from './googlePhotosMigrationAcceptance.js';

class MemoryLedger implements GooglePhotosMigrationLedger {
  constructor(
    private job: GooglePhotosMigrationJob | null,
    private items: GooglePhotosMigrationItem[],
  ) {}
  async createJob(job: GooglePhotosMigrationJob) { this.job = job; }
  async getJob(jobId: string) { return this.job?.id === jobId ? this.job : null; }
  async listJobs(workspaceId: string) { return this.job?.workspaceId === workspaceId ? [this.job] : []; }
  async updateJob(jobId: string, patch: Partial<Omit<GooglePhotosMigrationJob, 'id' | 'workspaceId' | 'createdAt'>>) {
    if (!this.job || this.job.id !== jobId) return null;
    this.job = { ...this.job, ...patch };
    return this.job;
  }
  async putItems(items: GooglePhotosMigrationItem[]) { this.items = items; }
  async listItems(jobId: string) { return this.items.filter(item => item.jobId === jobId); }
  async updateItem(itemId: string, patch: Partial<Omit<GooglePhotosMigrationItem, 'id' | 'jobId' | 'sourceMediaId' | 'createdAt'>>) {
    const index = this.items.findIndex(item => item.id === itemId);
    if (index < 0) return null;
    this.items[index] = { ...this.items[index], ...patch };
    return this.items[index];
  }
  async getTransferCheckpoint(_itemId: string): Promise<MigrationTransferCheckpoint | null> { return null; }
  async setTransferCheckpoint(_itemId: string, _checkpoint: MigrationTransferCheckpoint | null) {}
}

const now = '2026-09-08T15:00:00.000Z';
function job(patch: Partial<GooglePhotosMigrationJob> = {}): GooglePhotosMigrationJob {
  return {
    id: 'job-1', workspaceId: 'workspace-1', sourceAccountId: 'source-photos', sourcePickerSessionId: 'picker-session-1',
    target: 'google_photos', targetAccountId: 'target-photos', state: 'completed', totalItems: 1, completedItems: 1,
    failedItems: 0, transferredBytes: 123, createdAt: now, updatedAt: now, completedAt: now, ...patch,
  };
}
function item(patch: Partial<GooglePhotosMigrationItem> = {}): GooglePhotosMigrationItem {
  return {
    id: 'item-1', jobId: 'job-1', sourceMediaId: 'picked-media-1', filename: 'photo.jpg', state: 'completed', attempts: 1,
    transferredBytes: 123, targetId: 'destination-media-1', createdAt: now, updatedAt: now, ...patch,
  };
}

test('verifies Picker-selected append-only Google Photos migration from durable ledger', async () => {
  const status = await googlePhotosMigrationAcceptance(new MemoryLedger(job(), [item()]), { workspaceId: 'workspace-1', jobId: 'job-1' });
  assert.equal(status.status, 'verified');
  assert.equal(status.sourceMode, 'picker_selected_only');
  assert.equal(status.targetMode, 'append_only_google_photos');
  assert.equal(status.verifiedTargetItems, 1);
  assert.equal(status.durableProgress, true);
});

test('verifies Picker-selected migration to Google Drive', async () => {
  const status = await googlePhotosMigrationAcceptance(
    new MemoryLedger(job({ target: 'google_drive', targetAccountId: 'drive-account-1' }), [item({ targetId: 'drive-file-1' })]),
    { workspaceId: 'workspace-1', jobId: 'job-1' },
  );
  assert.equal(status.status, 'verified');
  assert.equal(status.targetMode, 'google_drive');
});

test('fails closed when Picker provenance is absent or completed target is unverified', async () => {
  const status = await googlePhotosMigrationAcceptance(
    new MemoryLedger(job({ sourcePickerSessionId: undefined }), [item({ targetId: undefined })]),
    { workspaceId: 'workspace-1', jobId: 'job-1' },
  );
  assert.equal(status.status, 'not_verified');
  assert.ok(status.blockers.includes('PICKER_SESSION_NOT_RECORDED'));
  assert.ok(status.blockers.includes('COMPLETED_ITEM_TARGET_NOT_VERIFIED'));
});

test('fails closed on durable progress mismatch and cross-workspace access', async () => {
  const ledger = new MemoryLedger(job({ totalItems: 2, completedItems: 2 }), [item()]);
  const mismatch = await googlePhotosMigrationAcceptance(ledger, { workspaceId: 'workspace-1', jobId: 'job-1' });
  assert.equal(mismatch.status, 'not_verified');
  assert.ok(mismatch.blockers.includes('DURABLE_TOTAL_ITEMS_MISMATCH'));
  assert.ok(mismatch.blockers.includes('DURABLE_COMPLETED_ITEMS_MISMATCH'));

  const isolated = await googlePhotosMigrationAcceptance(ledger, { workspaceId: 'workspace-2', jobId: 'job-1' });
  assert.equal(isolated.status, 'not_verified');
  assert.deepEqual(isolated.blockers, ['MIGRATION_JOB_NOT_FOUND_OR_WORKSPACE_MISMATCH']);
});

test('rejects same-account Google Photos source and destination', async () => {
  const status = await googlePhotosMigrationAcceptance(
    new MemoryLedger(job({ sourceAccountId: 'same', targetAccountId: 'same' }), [item()]),
    { workspaceId: 'workspace-1', jobId: 'job-1' },
  );
  assert.equal(status.status, 'not_verified');
  assert.ok(status.blockers.includes('GOOGLE_PHOTOS_SOURCE_TARGET_SAME_ACCOUNT'));
});
