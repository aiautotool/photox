import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';
import { acquireMediaCatalogAuthorityLease, mediaCatalogAuthorityLeaseExists } from './mediaCatalogAuthorityLease.js';
import { restoreMediaCatalogOffline } from './mediaCatalogOfflineRestore.js';

type Row = { workspaceId: string; key: string; filename: string };

async function fixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photox-catalog-restore-'));
  const sqlitePath = path.join(dir, 'media-catalog.sqlite');
  const sourcePath = path.join(dir, 'restore.json');
  const backupPath = path.join(dir, 'pre-restore.json');
  const leasePath = `${sqlitePath}.authority.lock`;
  return { dir, sqlitePath, sourcePath, backupPath, leasePath };
}

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function seed(sqlitePath: string, rows: Row[]) {
  const store = new SqlitePhotoXStore({ path: sqlitePath });
  const catalog = new SqliteMediaIndexCatalog<Row>(store);
  for (const row of rows) catalog.append(row);
  store.close();
}

test('offline restore replaces media rows transactionally and preserves a pre-restore backup', async () => {
  const f = await fixture();
  try {
    await seed(f.sqlitePath, [{ workspaceId: 'old', key: 'a', filename: 'old.jpg' }]);
    const incoming: Row[] = [
      { workspaceId: 'w1', key: 'a', filename: 'a.jpg' },
      { workspaceId: 'w2', key: 'a', filename: 'b.jpg' },
    ];
    const content = `${JSON.stringify(incoming, null, 2)}\n`;
    await fsp.writeFile(f.sourcePath, content, 'utf8');

    const result = restoreMediaCatalogOffline<Row>({
      sqlitePath: f.sqlitePath,
      sourcePath: f.sourcePath,
      expectedSha256: hash(content),
      backupPath: f.backupPath,
      leasePath: f.leasePath,
    });

    assert.equal(result.restoredCount, 2);
    assert.equal(result.sourceSha256, hash(content));
    assert.equal(result.backupPath, path.resolve(f.backupPath));
    assert.deepEqual(JSON.parse(await fsp.readFile(f.backupPath, 'utf8')), [{ workspaceId: 'old', key: 'a', filename: 'old.jpg' }]);

    const store = new SqlitePhotoXStore({ path: f.sqlitePath });
    const rows = new SqliteMediaIndexCatalog<Row>(store).listAll();
    store.close();
    assert.deepEqual(rows, incoming);
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline restore refuses while Desktop runtime owns catalog authority', async () => {
  const f = await fixture();
  try {
    await seed(f.sqlitePath, [{ workspaceId: 'w1', key: 'a', filename: 'a.jpg' }]);
    const content = '[]\n';
    await fsp.writeFile(f.sourcePath, content, 'utf8');
    const runtime = acquireMediaCatalogAuthorityLease(f.leasePath, 'desktop-runtime');
    assert.throws(
      () => restoreMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, sourcePath: f.sourcePath, expectedSha256: hash(content), leasePath: f.leasePath }),
      /MEDIA_CATALOG_AUTHORITY_ACTIVE:desktop-runtime/,
    );
    runtime.release();
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline restore verifies SHA before acquiring authority or mutating SQLite', async () => {
  const f = await fixture();
  try {
    const original = [{ workspaceId: 'w1', key: 'a', filename: 'a.jpg' }];
    await seed(f.sqlitePath, original);
    await fsp.writeFile(f.sourcePath, '[]\n', 'utf8');
    assert.throws(
      () => restoreMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, sourcePath: f.sourcePath, expectedSha256: '0'.repeat(64), leasePath: f.leasePath }),
      /MEDIA_CATALOG_RESTORE_SHA256_MISMATCH/,
    );
    assert.equal(fs.existsSync(f.leasePath), false);
    const store = new SqlitePhotoXStore({ path: f.sqlitePath });
    const rows = new SqliteMediaIndexCatalog<Row>(store).listAll();
    store.close();
    assert.deepEqual(rows, original);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline restore rejects duplicate tenant identity before mutation', async () => {
  const f = await fixture();
  try {
    const original = [{ workspaceId: 'w1', key: 'a', filename: 'old.jpg' }];
    await seed(f.sqlitePath, original);
    const duplicate = `${JSON.stringify([
      { workspaceId: 'w1', key: 'a', filename: 'one.jpg' },
      { workspaceId: 'w1', key: 'a', filename: 'two.jpg' },
    ])}\n`;
    await fsp.writeFile(f.sourcePath, duplicate, 'utf8');
    assert.throws(
      () => restoreMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, sourcePath: f.sourcePath, expectedSha256: hash(duplicate), leasePath: f.leasePath }),
      /MEDIA_CATALOG_RESTORE_DUPLICATE_IDENTITY:w1:a/,
    );
    const store = new SqlitePhotoXStore({ path: f.sqlitePath });
    const rows = new SqliteMediaIndexCatalog<Row>(store).listAll();
    store.close();
    assert.deepEqual(rows, original);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline restore releases operator authority when SQLite open fails', async () => {
  const f = await fixture();
  try {
    await fsp.writeFile(f.sqlitePath, 'not-sqlite', 'utf8');
    const content = '[]\n';
    await fsp.writeFile(f.sourcePath, content, 'utf8');
    assert.throws(
      () => restoreMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, sourcePath: f.sourcePath, expectedSha256: hash(content), leasePath: f.leasePath }),
      /database|sqlite|disk image|file is not a database/i,
    );
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});
