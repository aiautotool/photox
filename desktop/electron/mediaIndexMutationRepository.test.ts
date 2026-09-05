import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMediaIndexMutationRepository } from './mediaIndexMutationRepository.js';

type Row = {
  workspaceId: string;
  key: string;
  filename: string;
  videoProcessing?: string;
  thumbnailPath?: string;
  cloudState?: string;
};

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-repository-'));
  return { dir, file: path.join(dir, 'media-index.json') };
}

test('first-run append creates a missing media-index through the serialized boundary', async () => {
  const { dir, file } = await fixture();
  try {
    const repo = createMediaIndexMutationRepository<Row>(file);
    await repo.append({ workspaceId: 'w1', key: 'a', filename: 'a.jpg' });
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.deepEqual(rows, [{ workspaceId: 'w1', key: 'a', filename: 'a.jpg' }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('concurrent exact mutations preserve ingest and video/cloud patches', async () => {
  const { dir, file } = await fixture();
  try {
    const repo = createMediaIndexMutationRepository<Row>(file);
    await repo.append({ workspaceId: 'w1', key: 'video', filename: 'clip.mov' });
    await Promise.all([
      repo.append({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' }),
      repo.patch('w1', 'video', { videoProcessing: 'ready', thumbnailPath: '/cache/thumb.jpg' }),
      repo.patch('w1', 'video', { cloudState: 'VERIFIED' }),
    ]);
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(rows.find(row => row.key === 'photo')?.filename, 'photo.jpg');
    const video = rows.find(row => row.key === 'video');
    assert.equal(video?.videoProcessing, 'ready');
    assert.equal(video?.thumbnailPath, '/cache/thumb.jpg');
    assert.equal(video?.cloudState, 'VERIFIED');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('identical media keys remain workspace isolated for patch and remove', async () => {
  const { dir, file } = await fixture();
  try {
    const repo = createMediaIndexMutationRepository<Row>(file);
    await repo.append({ workspaceId: 'w1', key: 'same', filename: 'one.jpg' });
    await repo.append({ workspaceId: 'w2', key: 'same', filename: 'two.jpg' });
    await repo.patch('w1', 'same', { cloudState: 'ERROR' });
    const removed = await repo.remove('w2', 'same');
    assert.equal(removed?.filename, 'two.jpg');
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.workspaceId, 'w1');
    assert.equal(rows[0]?.cloudState, 'ERROR');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('patch cannot move a row across workspace or media identity', async () => {
  const { dir, file } = await fixture();
  try {
    const repo = createMediaIndexMutationRepository<Row>(file);
    await repo.append({ workspaceId: 'w1', key: 'a', filename: 'a.jpg' });
    const patched = await repo.patch('w1', 'a', current => ({
      ...current,
      workspaceId: 'w2',
      key: 'b',
      filename: 'renamed.jpg',
    }));
    assert.equal(patched?.workspaceId, 'w1');
    assert.equal(patched?.key, 'a');
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(rows[0]?.workspaceId, 'w1');
    assert.equal(rows[0]?.key, 'a');
    assert.equal(rows[0]?.filename, 'renamed.jpg');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('duplicate media identity fails closed instead of replacing an existing row', async () => {
  const { dir, file } = await fixture();
  try {
    const repo = createMediaIndexMutationRepository<Row>(file);
    await repo.append({ workspaceId: 'w1', key: 'a', filename: 'first.jpg' });
    await assert.rejects(
      () => repo.append({ workspaceId: 'w1', key: 'a', filename: 'second.jpg' }),
      /MEDIA_INDEX_DUPLICATE_KEY/,
    );
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.filename, 'first.jpg');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
