import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GooglePhotosMigrationRunner,
  migrationItemsFromPicker,
  pickedMediaDownloadUrl,
  transferPickedItems,
  type GooglePhotosMigrationItem,
  type GooglePhotosMigrationJob,
  type GooglePhotosMigrationLedger,
  type PickedMediaItem,
} from './index';

afterEach(() => vi.restoreAllMocks());

describe('Google Photos migration', () => {
  it('uses the Picker download form for photos and videos', () => {
    expect(pickedMediaDownloadUrl({ id: 'p', mediaFile: { baseUrl: 'https://example/photo', mimeType: 'image/jpeg' } })).toBe('https://example/photo=d');
    expect(pickedMediaDownloadUrl({ id: 'v', mediaFile: { baseUrl: 'https://example/video', mimeType: 'video/mp4' } })).toBe('https://example/video=dv');
  });

  it('continues a batch when one selected item fails', async () => {
    const items: PickedMediaItem[] = [
      { id: '1', mediaFile: { baseUrl: 'https://example/1', filename: '1.jpg', mimeType: 'image/jpeg' } },
      { id: '2', mediaFile: { baseUrl: 'https://example/2', filename: '2.jpg', mimeType: 'image/jpeg' } },
    ];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('one', { status: 200 }))
      .mockResolvedValueOnce(new Response('two', { status: 200 }));
    const results = await transferPickedItems(items, 'google_drive', async ({ item }) => {
      if (item.id === '1') throw new Error('destination failed');
      return { targetId: 'drive-2' };
    });
    expect(results).toEqual([
      { sourceId: '1', filename: '1.jpg', target: 'google_drive', success: false, error: 'destination failed' },
      { sourceId: '2', filename: '2.jpg', target: 'google_drive', success: true, targetId: 'drive-2' },
    ]);
  });

  it('builds durable queued ledger items without persisting picker base URLs', () => {
    const items = migrationItemsFromPicker('job-1', [
      { id: 'source-1', mediaFile: { baseUrl: 'https://temporary.example/item', filename: 'IMG.jpg', mimeType: 'image/jpeg' } },
    ], new Date('2026-09-03T00:00:00.000Z'));
    expect(items).toEqual([expect.objectContaining({
      id: 'job-1:0:source-1', sourceMediaId: 'source-1', filename: 'IMG.jpg', mimeType: 'image/jpeg', state: 'queued', attempts: 0,
    })]);
    expect(JSON.stringify(items)).not.toContain('temporary.example');
  });

  it('pauses without marking queued work complete and resumes only incomplete items', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-pause');
    await ledger.createJob(job);
    await ledger.putItems([
      ...migrationItemsFromPicker(job.id, [source('a'), source('b')]),
    ]);
    let calls = 0;
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer({ item }) { calls += 1; return { targetId: `target-${item.sourceMediaId}` }; },
    }, () => new Date('2026-09-03T00:00:00.000Z'));

    const paused = await runner.run(job.id, new Map([['a', source('a')], ['b', source('b')]]), {
      shouldPause: () => calls >= 1,
      shouldCancel: () => false,
    });
    expect(paused.state).toBe('paused');
    expect((await ledger.listItems(job.id)).map(item => item.state)).toEqual(['completed', 'queued']);

    const finished = await runner.run(job.id, new Map([['a', source('a')], ['b', source('b')]]), {
      shouldPause: () => false,
      shouldCancel: () => false,
    });
    expect(finished.state).toBe('completed');
    expect(calls).toBe(2);
    expect((await ledger.listItems(job.id)).every(item => item.state === 'completed')).toBe(true);
  });

  it('retries failed items without repeating completed items', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-retry');
    await ledger.createJob(job);
    const [first, second] = migrationItemsFromPicker(job.id, [source('a'), source('b')]);
    first.state = 'completed';
    second.state = 'failed';
    second.attempts = 1;
    await ledger.putItems([first, second]);
    const transferred: string[] = [];
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer({ item }) { transferred.push(item.sourceMediaId); return { targetId: `target-${item.sourceMediaId}` }; },
    });
    const result = await runner.run(job.id, new Map([['a', source('a')], ['b', source('b')]]), { shouldPause: () => false, shouldCancel: () => false });
    expect(result.state).toBe('completed');
    expect(transferred).toEqual(['b']);
    expect((await ledger.listItems(job.id)).find(item => item.sourceMediaId === 'b')?.attempts).toBe(2);
  });

  it('refuses to run a migration job owned by another workspace', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-cross-tenant');
    await ledger.createJob(job);
    await ledger.putItems(migrationItemsFromPicker(job.id, [source('a')]));
    const transferred: string[] = [];
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer({ item }) { transferred.push(item.sourceMediaId); return { targetId: 'should-not-run' }; },
    });
    await expect(runner.run(job.id, new Map([['a', source('a')]]), {
      workspaceId: 'workspace-2', shouldPause: () => false, shouldCancel: () => false,
    })).rejects.toThrow('MIGRATION_WORKSPACE_MISMATCH');
    expect(transferred).toEqual([]);
    expect((await ledger.getJob(job.id))?.state).toBe('queued');
    expect((await ledger.listItems(job.id))[0]?.state).toBe('queued');
  });

});

function source(id: string): PickedMediaItem {
  return { id, mediaFile: { baseUrl: `https://picker/${id}`, filename: `${id}.jpg`, mimeType: 'image/jpeg' } };
}

function makeJob(id: string): GooglePhotosMigrationJob {
  return {
    id, workspaceId: 'workspace-1', sourceAccountId: 'source-account', target: 'google_drive', targetAccountId: 'target-account', state: 'queued',
    totalItems: 2, completedItems: 0, failedItems: 0, transferredBytes: 0,
    createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
  };
}

class MemoryLedger implements GooglePhotosMigrationLedger {
  jobs = new Map<string, GooglePhotosMigrationJob>();
  items = new Map<string, GooglePhotosMigrationItem>();
  async createJob(job: GooglePhotosMigrationJob) { this.jobs.set(job.id, { ...job }); }
  async getJob(jobId: string) { const job = this.jobs.get(jobId); return job ? { ...job } : null; }
  async listJobs(workspaceId: string) { return [...this.jobs.values()].filter(job => job.workspaceId === workspaceId).map(job => ({ ...job })); }
  async updateJob(jobId: string, patch: Partial<GooglePhotosMigrationJob>) { const job = this.jobs.get(jobId); if (!job) return null; const next = { ...job, ...patch }; this.jobs.set(jobId, next); return { ...next }; }
  async putItems(items: GooglePhotosMigrationItem[]) { for (const item of items) this.items.set(item.id, { ...item }); }
  async listItems(jobId: string) { return [...this.items.values()].filter(item => item.jobId === jobId).map(item => ({ ...item })); }
  async updateItem(itemId: string, patch: Partial<GooglePhotosMigrationItem>) { const item = this.items.get(itemId); if (!item) return null; const next = { ...item, ...patch }; this.items.set(itemId, next); return { ...next }; }
}
