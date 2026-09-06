import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';
import {
  loadMediaRepairCatalogRow,
  upsertMediaRepairCatalogReplica,
  type MediaRepairCatalogRow,
} from './mediaRepairCatalog.js';

type Row = MediaRepairCatalogRow & {
  filename: string;
  path: string;
  size: number;
};

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-repair-catalog-'));
  const databasePath = path.join(dir, 'media-catalog.sqlite');
  const store = new SqlitePhotoXStore({ path: databasePath });
  const catalog = new SqliteMediaIndexCatalog<Row>(store);
  catalog.append({ workspaceId: 'w1', key: 'same', filename: 'one.jpg', path: '/one.jpg', size: 1 });
  catalog.append({ workspaceId: 'w2', key: 'same', filename: 'two.jpg', path: '/two.jpg', size: 2 });
  store.close();
  return { dir, databasePath };
}

test('media repair reads exact workspace row from SQLite authority', async () => {
  const { dir, databasePath } = await fixture();
  try {
    assert.equal(loadMediaRepairCatalogRow(databasePath, 'w1', 'same')?.filename, 'one.jpg');
    assert.equal(loadMediaRepairCatalogRow(databasePath, 'w2', 'same')?.filename, 'two.jpg');
    assert.equal(loadMediaRepairCatalogRow(databasePath, 'missing', 'same'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('media repair replica merge is tenant scoped and preserves other account progress', async () => {
  const { dir, databasePath } = await fixture();
  try {
    upsertMediaRepairCatalogReplica(databasePath, 'w1', 'same', {
      state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'a1',
    });
    upsertMediaRepairCatalogReplica(databasePath, 'w1', 'same', {
      state: 'UPLOADING', accountId: 'drive-b',
    });
    upsertMediaRepairCatalogReplica(databasePath, 'w1', 'same', {
      state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'b1',
    });

    const w1 = loadMediaRepairCatalogRow(databasePath, 'w1', 'same');
    const w2 = loadMediaRepairCatalogRow(databasePath, 'w2', 'same');
    assert.equal(w1?.cloudReplicas?.length, 2);
    assert.equal(w1?.cloudReplicas?.find(item => item.accountId === 'drive-a')?.remoteFileId, 'a1');
    assert.equal(w1?.cloudReplicas?.find(item => item.accountId === 'drive-b')?.remoteFileId, 'b1');
    assert.equal(w2?.cloudReplicas, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('media repair fails closed when the exact SQLite catalog row does not exist', async () => {
  const { dir, databasePath } = await fixture();
  try {
    assert.throws(
      () => upsertMediaRepairCatalogReplica(databasePath, 'w1', 'missing', { state: 'ERROR', accountId: 'drive-a' }),
      /MEDIA_REPAIR_NOT_FOUND/,
    );
    assert.throws(() => loadMediaRepairCatalogRow(databasePath, '', 'same'), /MEDIA_REPAIR_WORKSPACE_REQUIRED/);
    assert.throws(() => loadMediaRepairCatalogRow(databasePath, 'w1', ''), /MEDIA_REPAIR_KEY_REQUIRED/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
