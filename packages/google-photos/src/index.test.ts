import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GooglePhotosMigrationRunner,
  migrationItemsFromPicker,
  pickedMediaDownloadUrl,
  transferPickedItems,
  uploadPhotoStream,
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

  it('streams upload bodies without buffering and reports byte progress', async () => {
    const progress: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      const body = init?.body as ReadableStream<Uint8Array>;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      expect(chunks.map(chunk => [...chunk])).toEqual([[1, 2], [3, 4, 5]]);
      expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
      expect(new Headers(init?.headers).get('content-length')).toBe('5');
      return new Response('upload-token', { status: 200 });
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });
    await expect(uploadPhotoStream('access-token', stream, 'video/mp4', { contentLength: 5, onBytes: bytes => progress.push(bytes) })).resolves.toBe('upload-token');
    expect(progress).toEqual([2, 5]);
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


  it('persists a transfer checkpoint after failure and clears it only after verified completion', async () => {
    const ledger = new MemoryLedger();
    const job = makeJob('job-checkpoint');
    await ledger.createJob(job);
    const [item] = migrationItemsFromPicker(job.id, [source('a')]);
    await ledger.putItems([item]);
    let first = true;
    const checkpoint = { kind: 'google_drive_resumable_v1' as const, accountId: 'target-account', sessionUri: 'https://upload/session', nextByte: 8, totalBytes: 16, updatedAt: '2026-09-03T00:00:00.000Z' };
    const runner = new GooglePhotosMigrationRunner(ledger, {
      async transfer({ checkpoint: existing, onCheckpoint }) {
        if (first) { first = false; expect(existing).toBeUndefined(); await onCheckpoint?.(checkpoint); throw new Error('network dropped'); }
        expect(existing).toEqual(checkpoint); return { targetId: 'drive-final' };
      },
      async verify() {},
    });
    const sources = new Map([['a', source('a')]]);
    const failed = await runner.run(job.id, sources, { shouldPause: () => false, shouldCancel: () => false });
    expect(failed.state).toBe('completed_with_errors');
    expect(await ledger.getTransferCheckpoint(item.id)).toEqual(checkpoint);
    const completed = await runner.run(job.id, sources, { shouldPause: () => false, shouldCancel: () => false });
    expect(completed.state).toBe('completed');
    expect(await ledger.getTransferCheckpoint(item.id)).toBeNull();
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
  checkpoints = new Map<string, any>();
  async createJob(job: GooglePhotosMigrationJob) { this.jobs.set(job.id, { ...job }); }
  async getJob(jobId: string) { const job = this.jobs.get(jobId); return job ? { ...job } : null; }
  async listJobs(workspaceId: string) { return [...this.jobs.values()].filter(job => job.workspaceId === workspaceId).map(job => ({ ...job })); }
  async updateJob(jobId: string, patch: Partial<GooglePhotosMigrationJob>) { const job = this.jobs.get(jobId); if (!job) return null; const next = { ...job, ...patch }; this.jobs.set(jobId, next); return { ...next }; }
  async putItems(items: GooglePhotosMigrationItem[]) { for (const item of items) this.items.set(item.id, { ...item }); }
  async listItems(jobId: string) { return [...this.items.values()].filter(item => item.jobId === jobId).map(item => ({ ...item })); }
  async updateItem(itemId: string, patch: Partial<GooglePhotosMigrationItem>) { const item = this.items.get(itemId); if (!item) return null; const next = { ...item, ...patch }; this.items.set(itemId, next); return { ...next }; }
  async getTransferCheckpoint(itemId: string) { return this.checkpoints.get(itemId) ?? null; }
  async setTransferCheckpoint(itemId: string, checkpoint: any | null) { if (checkpoint) this.checkpoints.set(itemId, checkpoint); else this.checkpoints.delete(itemId); }
}
