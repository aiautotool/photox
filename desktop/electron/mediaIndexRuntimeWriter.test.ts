import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMediaIndexRuntimeWriter, type RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

type Row = RuntimeMediaIndexRow & {
  filename: string;
  thumbnailPath?: string;
  duration?: number;
};

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-runtime-writer-'));
  return { dir, file: path.join(dir, 'media-index.json') };
}

test('runtime writer serializes ingest with video and replica mutations', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'video', filename: 'clip.mov' });
    await Promise.all([
      writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' }),
      writer.patchVideo('w1', 'video', { videoProcessing: 'ready', thumbnailPath: '/cache/thumb.jpg', duration: 12.5 }),
      writer.upsertReplica('w1', 'video', { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'remote-a' }),
    ]);

    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(rows.find(row => row.key === 'photo')?.filename, 'photo.jpg');
    const video = rows.find(row => row.key === 'video');
    assert.equal(video?.videoProcessing, 'ready');
    assert.equal(video?.thumbnailPath, '/cache/thumb.jpg');
    assert.equal(video?.duration, 12.5);
    assert.equal(video?.cloudReplicas?.[0]?.state, 'VERIFIED');
    assert.equal(video?.cloudReplicas?.[0]?.accountId, 'drive-a');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('replica upserts merge per account and preserve other provider state', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({
      workspaceId: 'w1',
      key: 'photo',
      filename: 'photo.jpg',
      cloudReplicas: [
        { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a' },
        { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'b', verifiedAt: 'before' },
      ],
    });

    await Promise.all([
      writer.upsertReplica('w1', 'photo', { state: 'ERROR', accountId: 'drive-a', message: 'retry failed' }),
      writer.upsertReplica('w1', 'photo', { state: 'VERIFIED', accountId: 'drive-b', verifiedAt: 'after' }),
    ]);

    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    const driveA = row.cloudReplicas?.find(replica => replica.accountId === 'drive-a');
    const driveB = row.cloudReplicas?.find(replica => replica.accountId === 'drive-b');
    assert.equal(driveA?.state, 'ERROR');
    assert.equal(driveA?.remoteFileId, 'a');
    assert.equal(driveB?.state, 'VERIFIED');
    assert.equal(driveB?.remoteFileId, 'b');
    assert.equal(driveB?.verifiedAt, 'after');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('account-less retry markers are replaced instead of accumulating', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' });
    await writer.upsertReplica('w1', 'photo', { state: 'QUEUED', message: 'waiting one' });
    await writer.upsertReplica('w1', 'photo', { state: 'QUEUED', message: 'waiting two' });
    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    const pending = row.cloudReplicas?.filter(replica => !replica.accountId) ?? [];
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.message, 'waiting two');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('syncReplicas preserves concurrent account progress from the authoritative row', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({
      workspaceId: 'w1',
      key: 'photo',
      filename: 'photo.jpg',
      cloudReplicas: [{ state: 'UPLOADING', accountId: 'drive-a', remoteFileId: 'a-old' }],
    });

    const staleSnapshot = [{ state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a-new' }];
    await writer.upsertReplica('w1', 'photo', { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'b-new' });
    const committed = await writer.syncReplicas('w1', 'photo', staleSnapshot);

    assert.equal(committed?.cloudReplicas?.find(replica => replica.accountId === 'drive-a')?.remoteFileId, 'a-new');
    assert.equal(committed?.cloudReplicas?.find(replica => replica.accountId === 'drive-b')?.remoteFileId, 'b-new');
    const [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(row.cloudReplicas?.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('syncReplicas clears stale queue marker once caller snapshot has provider state only', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' });
    await writer.upsertReplica('w1', 'photo', { state: 'QUEUED', message: 'waiting for capacity' });
    const committed = await writer.syncReplicas('w1', 'photo', [
      { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a' },
    ]);
    assert.equal(committed?.cloudReplicas?.some(replica => !replica.accountId), false);
    assert.equal(committed?.cloudReplicas?.[0]?.state, 'VERIFIED');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('syncReplicas keeps only the newest transient marker from a caller snapshot', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' });
    const committed = await writer.syncReplicas('w1', 'photo', [
      { state: 'QUEUED', message: 'older' },
      { state: 'QUEUED', message: 'newer' },
    ]);
    const pending = committed?.cloudReplicas?.filter(replica => !replica.accountId) ?? [];
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.message, 'newer');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('deletion tombstone blocks video and replica writers until its owner clears it', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({
      workspaceId: 'w1',
      key: 'video',
      filename: 'clip.mov',
      videoProcessing: 'processing',
      cloudReplicas: [{ state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a' }],
    });
    const claimed = await writer.claimDeletion('w1', 'video', 'delete-1', '2026-09-06T00:00:00.000Z');
    assert.equal(claimed?.deletion?.claimId, 'delete-1');

    await Promise.all([
      writer.patchVideo('w1', 'video', { videoProcessing: 'ready', duration: 42 }),
      writer.upsertReplica('w1', 'video', { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'b' }),
      writer.syncReplicas('w1', 'video', [{ state: 'ERROR', accountId: 'drive-a', remoteFileId: 'a' }]),
    ]);

    let [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(row.deletion?.claimId, 'delete-1');
    assert.equal(row.videoProcessing, 'processing');
    assert.equal(row.duration, undefined);
    assert.equal(row.cloudReplicas?.length, 1);
    assert.equal(row.cloudReplicas?.[0]?.state, 'VERIFIED');

    const wrongClear = await writer.clearDeletion('w1', 'video', 'delete-2');
    assert.equal(wrongClear?.deletion?.claimId, 'delete-1');
    const cleared = await writer.clearDeletion('w1', 'video', 'delete-1');
    assert.equal(cleared?.deletion, undefined);
    await writer.patchVideo('w1', 'video', { videoProcessing: 'ready', duration: 42 });
    [row] = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.equal(row.videoProcessing, 'ready');
    assert.equal(row.duration, 42);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('only the deletion claim owner can finalize catalog removal', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' });
    await writer.claimDeletion('w1', 'photo', 'owner-claim');
    assert.equal(await writer.removeClaimed('w1', 'photo', 'other-claim'), null);
    assert.equal((JSON.parse(await fs.readFile(file, 'utf8')) as Row[]).length, 1);
    const removed = await writer.removeClaimed('w1', 'photo', 'owner-claim');
    assert.equal(removed?.filename, 'photo.jpg');
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('remove stays tenant isolated when identical keys exist in two workspaces', async () => {
  const { dir, file } = await fixture();
  try {
    const writer = createMediaIndexRuntimeWriter<Row>(file);
    await writer.ingest({ workspaceId: 'w1', key: 'same', filename: 'one.jpg' });
    await writer.ingest({ workspaceId: 'w2', key: 'same', filename: 'two.jpg' });
    const removed = await writer.remove('w1', 'same');
    assert.equal(removed?.filename, 'one.jpg');
    const rows = JSON.parse(await fs.readFile(file, 'utf8')) as Row[];
    assert.deepEqual(rows.map(row => [row.workspaceId, row.key, row.filename]), [['w2', 'same', 'two.jpg']]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
