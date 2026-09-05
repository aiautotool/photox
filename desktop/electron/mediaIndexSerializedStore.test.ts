import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mutateSerializedJsonArray } from './mediaIndexSerializedStore.js';

async function fixture(rows: Array<Record<string, unknown>>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-index-'));
  const file = path.join(dir, 'media-index.json');
  await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
  return { dir, file };
}

test('serialized mutations preserve concurrent updates instead of losing one writer', async () => {
  const { dir, file } = await fixture([{ key: 'a', count: 0 }]);
  try {
    const first = mutateSerializedJsonArray<Record<string, unknown>>(file, async rows => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return rows.map(row => row.key === 'a' ? { ...row, first: true } : row);
    });
    const second = mutateSerializedJsonArray<Record<string, unknown>>(file, rows =>
      rows.map(row => row.key === 'a' ? { ...row, second: true } : row),
    );
    await Promise.all([first, second]);
    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(row.first, true);
    assert.equal(row.second, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mutation retries against an external legacy writer and merges the latest snapshot', async () => {
  const { dir, file } = await fixture([{ key: 'a', original: true }]);
  try {
    let attempts = 0;
    await mutateSerializedJsonArray<Record<string, unknown>>(file, async rows => {
      attempts += 1;
      if (attempts === 1) {
        await fs.writeFile(file, JSON.stringify([{ key: 'a', original: true, legacyWriter: true }], null, 2), 'utf8');
      }
      return rows.map(row => ({ ...row, serializedWriter: true }));
    });
    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Array<Record<string, unknown>>;
    assert.ok(attempts >= 2);
    assert.equal(row.legacyWriter, true);
    assert.equal(row.serializedWriter, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('replica verifier mutation preserves a concurrent legacy ingest row', async () => {
  const initial = [{ workspaceId: 'w1', key: 'existing', filename: 'a.jpg', cloudReplicas: [{ accountId: 'drive-a', state: 'VERIFIED' }] }];
  const { dir, file } = await fixture(initial);
  try {
    let attempts = 0;
    await mutateSerializedJsonArray<Record<string, unknown>>(file, async rows => {
      attempts += 1;
      if (attempts === 1) {
        await fs.writeFile(file, JSON.stringify([
          ...initial,
          { workspaceId: 'w1', key: 'new-ingest', filename: 'new.jpg', videoProcessing: undefined },
        ], null, 2), 'utf8');
      }
      return rows.map(row => row.key === 'existing' ? {
        ...row,
        cloudReplicas: [{ accountId: 'drive-a', state: 'ERROR', message: 'DRIVE_REPLICA_MISSING' }],
      } : row);
    }, { tempLabel: 'replica-health' });
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Array<Record<string, any>>;
    assert.ok(attempts >= 2);
    assert.equal(rows.find(row => row.key === 'existing')?.cloudReplicas?.[0]?.state, 'ERROR');
    assert.equal(rows.find(row => row.key === 'new-ingest')?.filename, 'new.jpg');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('replica verifier mutation preserves concurrent legacy video-processing metadata', async () => {
  const initial = [{ workspaceId: 'w1', key: 'video', filename: 'clip.mov', videoProcessing: 'processing', cloudReplicas: [{ accountId: 'drive-a', state: 'VERIFIED' }] }];
  const { dir, file } = await fixture(initial);
  try {
    let attempts = 0;
    await mutateSerializedJsonArray<Record<string, unknown>>(file, async rows => {
      attempts += 1;
      if (attempts === 1) {
        await fs.writeFile(file, JSON.stringify([{ ...initial[0], videoProcessing: 'ready', thumbnailPath: '/cache/thumb.jpg', playbackPath: '/cache/playback.mp4', duration: 12.5 }], null, 2), 'utf8');
      }
      return rows.map(row => row.key === 'video' ? {
        ...row,
        cloudReplicas: [{ accountId: 'drive-a', state: 'VERIFIED', remoteCheckedAt: '2026-09-05T00:00:00.000Z' }],
      } : row);
    }, { tempLabel: 'replica-health' });
    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Array<Record<string, any>>;
    assert.ok(attempts >= 2);
    assert.equal(row.videoProcessing, 'ready');
    assert.equal(row.thumbnailPath, '/cache/thumb.jpg');
    assert.equal(row.playbackPath, '/cache/playback.mp4');
    assert.equal(row.duration, 12.5);
    assert.equal(row.cloudReplicas?.[0]?.remoteCheckedAt, '2026-09-05T00:00:00.000Z');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid media-index JSON shape fails closed', async () => {
  const { dir, file } = await fixture([]);
  try {
    await fs.writeFile(file, JSON.stringify({ not: 'an array' }), 'utf8');
    await assert.rejects(
      () => mutateSerializedJsonArray(file, rows => rows),
      /MEDIA_INDEX_INVALID/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
