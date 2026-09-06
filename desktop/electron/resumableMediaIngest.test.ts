import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResumableMediaIngestStore } from './resumableMediaIngest.js';

async function withTempStore(run: (ctx: { root: string; store: ResumableMediaIngestStore; now: { value: number } }) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-ingest-'));
  const now = { value: Date.UTC(2026, 8, 7, 0, 0, 0) };
  const store = new ResumableMediaIngestStore({ rootDir: root, now: () => now.value, defaultTtlMs: 60_000, maxChunkBytes: 4 });
  try {
    await run({ root, store, now });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const input = {
  workspaceId: 'ws-a',
  deviceId: 'device-a',
  assetId: 'asset-a',
  filename: 'IMG_0001.JPG',
  mimeType: 'image/jpeg',
  mediaType: 'photo' as const,
  createdAt: 1_700_000_000_000,
  expectedBytes: 6,
};

test('persists server-authoritative acknowledged offset across store restart', async () => {
  await withTempStore(async ({ root, store, now }) => {
    const created = await store.create(input);
    assert.equal(created.acknowledgedBytes, 0);

    const first = await store.appendChunk({
      sessionId: created.sessionId,
      workspaceId: input.workspaceId,
      deviceId: input.deviceId,
      offset: 0,
      chunk: Uint8Array.from([1, 2, 3, 4]),
    });
    assert.equal(first.acknowledgedBytes, 4);

    now.value += 500;
    const restarted = new ResumableMediaIngestStore({ rootDir: root, now: () => now.value, defaultTtlMs: 60_000, maxChunkBytes: 4 });
    const status = await restarted.get(created.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId });
    assert.equal(status.acknowledgedBytes, 4);

    const completed = await restarted.appendChunk({
      sessionId: created.sessionId,
      workspaceId: input.workspaceId,
      deviceId: input.deviceId,
      offset: 4,
      chunk: Uint8Array.from([5, 6]),
    });
    assert.equal(completed.acknowledgedBytes, 6);
    const ready = await restarted.requireComplete(created.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId });
    assert.deepEqual([...await fs.readFile(ready.partPath)], [1, 2, 3, 4, 5, 6]);
  });
});

test('rejects stale, skipped, oversized and overrun chunks without moving acknowledged offset', async () => {
  await withTempStore(async ({ store }) => {
    const created = await store.create(input);
    await store.appendChunk({ sessionId: created.sessionId, workspaceId: input.workspaceId, deviceId: input.deviceId, offset: 0, chunk: Uint8Array.from([1, 2]) });

    await assert.rejects(
      store.appendChunk({ sessionId: created.sessionId, workspaceId: input.workspaceId, deviceId: input.deviceId, offset: 0, chunk: Uint8Array.from([9]) }),
      /UPLOAD_OFFSET_MISMATCH:2/,
    );
    await assert.rejects(
      store.appendChunk({ sessionId: created.sessionId, workspaceId: input.workspaceId, deviceId: input.deviceId, offset: 3, chunk: Uint8Array.from([9]) }),
      /UPLOAD_OFFSET_MISMATCH:2/,
    );
    await assert.rejects(
      store.appendChunk({ sessionId: created.sessionId, workspaceId: input.workspaceId, deviceId: input.deviceId, offset: 2, chunk: Uint8Array.from([1, 2, 3, 4, 5]) }),
      /UPLOAD_CHUNK_TOO_LARGE/,
    );
    await assert.rejects(
      store.appendChunk({ sessionId: created.sessionId, workspaceId: input.workspaceId, deviceId: input.deviceId, offset: 2, chunk: Uint8Array.from([1, 2, 3, 4]) }),
      /UPLOAD_INCOMPLETE|UPLOAD_EXCEEDS_EXPECTED_BYTES/,
    ).catch(async error => {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UPLOAD_EXCEEDS_EXPECTED_BYTES/.test(message)) throw error;
    });

    const status = await store.get(created.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId });
    assert.equal(status.acknowledgedBytes, 2);
  });
});

test('binds sessions to workspace and device and refuses incomplete finalization', async () => {
  await withTempStore(async ({ store }) => {
    const created = await store.create(input);
    await assert.rejects(
      store.get(created.sessionId, { workspaceId: 'ws-b', deviceId: input.deviceId }),
      /UPLOAD_SESSION_BINDING_MISMATCH/,
    );
    await assert.rejects(
      store.get(created.sessionId, { workspaceId: input.workspaceId, deviceId: 'device-b' }),
      /UPLOAD_SESSION_BINDING_MISMATCH/,
    );
    await assert.rejects(
      store.requireComplete(created.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId }),
      /UPLOAD_INCOMPLETE:0/,
    );
  });
});

test('fails closed when metadata acknowledged offset disagrees with durable part bytes', async () => {
  await withTempStore(async ({ root, store }) => {
    const created = await store.create(input);
    const metadataPath = path.join(root, `${created.sessionId}.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
    metadata.acknowledgedBytes = 3;
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8');

    await assert.rejects(
      store.get(created.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId }),
      /UPLOAD_SESSION_OFFSET_CORRUPT/,
    );
  });
});

test('expires and cleans sessions only after their server deadline', async () => {
  await withTempStore(async ({ root, store, now }) => {
    const created = await store.create({ ...input, ttlMs: 1000 });
    now.value += 999;
    assert.equal((await store.get(created.sessionId)).sessionId, created.sessionId);
    assert.equal(await store.cleanupExpired(), 0);

    now.value += 1;
    await assert.rejects(store.get(created.sessionId), /UPLOAD_SESSION_EXPIRED/);
    assert.equal(await store.cleanupExpired(), 1);
    await assert.rejects(store.get(created.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
    assert.deepEqual(await fs.readdir(root), []);
  });
});
