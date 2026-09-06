import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';
import { createMediaIndexRuntimeWriter, type RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';
import { createSqliteMediaIndexMutationRepository } from './mediaIndexSqliteRepository.js';

type Row = RuntimeMediaIndexRow & {
  filename: string;
  thumbnailPath?: string;
};

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-sqlite-runtime-'));
  const store = new SqlitePhotoXStore({ path: path.join(dir, 'photox.sqlite') });
  const catalog = new SqliteMediaIndexCatalog<Row>(store);
  const repository = createSqliteMediaIndexMutationRepository(catalog);
  const writer = createMediaIndexRuntimeWriter(repository);
  return { dir, store, catalog, writer };
}

test('sqlite runtime backend preserves exact workspace identity and semantic patches', async () => {
  const { dir, store, catalog, writer } = await fixture();
  try {
    await writer.ingest({ workspaceId: 'w1', key: 'same', filename: 'one.mov' });
    await writer.ingest({ workspaceId: 'w2', key: 'same', filename: 'two.mov' });

    await writer.patchVideo('w1', 'same', {
      videoProcessing: 'ready',
      thumbnailPath: '/cache/one.jpg',
    });

    assert.equal(catalog.get('w1', 'same')?.videoProcessing, 'ready');
    assert.equal(catalog.get('w1', 'same')?.thumbnailPath, '/cache/one.jpg');
    assert.equal(catalog.get('w2', 'same')?.videoProcessing, undefined);
    assert.equal(catalog.get('w2', 'same')?.filename, 'two.mov');
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sqlite runtime backend keeps replica progress and deletion tombstones authoritative', async () => {
  const { dir, store, catalog, writer } = await fixture();
  try {
    await writer.ingest({ workspaceId: 'w1', key: 'photo', filename: 'photo.jpg' });
    await Promise.all([
      writer.upsertReplica('w1', 'photo', { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a1' }),
      writer.upsertReplica('w1', 'photo', { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'b1' }),
    ]);

    const beforeDelete = catalog.get('w1', 'photo');
    assert.equal(beforeDelete?.cloudReplicas?.length, 2);
    assert.equal(beforeDelete?.cloudReplicas?.find(item => item.accountId === 'drive-a')?.remoteFileId, 'a1');
    assert.equal(beforeDelete?.cloudReplicas?.find(item => item.accountId === 'drive-b')?.remoteFileId, 'b1');

    const claimed = await writer.claimDeletion('w1', 'photo', 'claim-1', '2026-09-06T00:00:00.000Z');
    assert.equal(claimed?.deletion?.claimId, 'claim-1');

    await writer.patchVideo('w1', 'photo', { videoProcessing: 'ready' });
    await writer.upsertReplica('w1', 'photo', { state: 'ERROR', accountId: 'drive-a' });
    const deleting = catalog.get('w1', 'photo');
    assert.equal(deleting?.videoProcessing, undefined);
    assert.equal(deleting?.cloudReplicas?.find(item => item.accountId === 'drive-a')?.state, 'VERIFIED');

    assert.equal(await writer.removeClaimed('w1', 'photo', 'wrong-claim'), null);
    const removed = await writer.removeClaimed('w1', 'photo', 'claim-1');
    assert.equal(removed?.key, 'photo');
    assert.equal(catalog.get('w1', 'photo'), null);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sqlite mutation adapter preserves duplicate and identity immutability failures', async () => {
  const { dir, store, catalog, writer } = await fixture();
  try {
    await writer.ingest({ workspaceId: 'w1', key: 'a', filename: 'first.jpg' });
    await assert.rejects(
      () => writer.ingest({ workspaceId: 'w1', key: 'a', filename: 'second.jpg' }),
      /MEDIA_INDEX_DUPLICATE_KEY/,
    );

    const repository = createSqliteMediaIndexMutationRepository(catalog);
    const patched = await repository.patch('w1', 'a', current => ({
      ...current,
      workspaceId: 'w2',
      key: 'b',
      filename: 'renamed.jpg',
    }));
    assert.equal(patched?.workspaceId, 'w1');
    assert.equal(patched?.key, 'a');
    assert.equal(patched?.filename, 'renamed.jpg');
    assert.equal(catalog.get('w2', 'b'), null);
  } finally {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
