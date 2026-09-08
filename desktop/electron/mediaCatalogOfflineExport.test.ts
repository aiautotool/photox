import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';
import { acquireMediaCatalogAuthorityLease, mediaCatalogAuthorityLeaseExists } from './mediaCatalogAuthorityLease.js';
import { exportMediaCatalogOffline } from './mediaCatalogOfflineExport.js';

type Row = { workspaceId: string; key: string; filename: string };

async function fixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photox-catalog-export-'));
  return {
    dir,
    sqlitePath: path.join(dir, 'media-catalog.sqlite'),
    leasePath: path.join(dir, 'media-catalog.sqlite.authority.lock'),
    targetPath: path.join(dir, 'rollback.json'),
  };
}

test('authority lease blocks concurrent runtime/operator ownership and releases cleanly', async () => {
  const f = await fixture();
  try {
    const runtime = acquireMediaCatalogAuthorityLease(f.leasePath, 'desktop-runtime');
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), true);
    assert.throws(
      () => acquireMediaCatalogAuthorityLease(f.leasePath, 'operator-export'),
      /MEDIA_CATALOG_AUTHORITY_ACTIVE:desktop-runtime/,
    );
    runtime.release();
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
    const operator = acquireMediaCatalogAuthorityLease(f.leasePath, 'operator-export');
    operator.release();
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('malformed authority lease fails closed', async () => {
  const f = await fixture();
  try {
    await fsp.writeFile(f.leasePath, '{bad-json', 'utf8');
    assert.throws(
      () => acquireMediaCatalogAuthorityLease(f.leasePath, 'operator-export'),
      /MEDIA_CATALOG_AUTHORITY_LOCK_INVALID/,
    );
    assert.equal(fs.existsSync(f.leasePath), true);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline export refuses while Desktop authority is active', async () => {
  const f = await fixture();
  try {
    const store = new SqlitePhotoXStore({ path: f.sqlitePath });
    const catalog = new SqliteMediaIndexCatalog<Row>(store);
    catalog.append({ workspaceId: 'w1', key: 'a', filename: 'a.jpg' });
    store.close();

    const runtime = acquireMediaCatalogAuthorityLease(f.leasePath, 'desktop-runtime');
    assert.throws(
      () => exportMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, targetPath: f.targetPath, leasePath: f.leasePath }),
      /MEDIA_CATALOG_AUTHORITY_ACTIVE:desktop-runtime/,
    );
    assert.equal(fs.existsSync(f.targetPath), false);
    runtime.release();
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline export creates an atomic rollback JSON artifact and releases authority', async () => {
  const f = await fixture();
  try {
    const store = new SqlitePhotoXStore({ path: f.sqlitePath });
    const catalog = new SqliteMediaIndexCatalog<Row>(store);
    catalog.append({ workspaceId: 'w1', key: 'a', filename: 'a.jpg' });
    catalog.append({ workspaceId: 'w2', key: 'a', filename: 'b.jpg' });
    store.close();

    const result = exportMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, targetPath: f.targetPath, leasePath: f.leasePath });
    assert.equal(result.exportedCount, 2);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.targetPath, path.resolve(f.targetPath));
    const rows = JSON.parse(await fsp.readFile(f.targetPath, 'utf8')) as Row[];
    assert.deepEqual(rows.map(row => `${row.workspaceId}:${row.key}:${row.filename}`), ['w1:a:a.jpg', 'w2:a:b.jpg']);
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline export releases authority when SQLite open fails', async () => {
  const f = await fixture();
  try {
    await fsp.writeFile(f.sqlitePath, 'not-a-sqlite-database', 'utf8');
    assert.throws(
      () => exportMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, targetPath: f.targetPath, leasePath: f.leasePath }),
      /database|sqlite|disk image|file is not a database/i,
    );
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline export refuses missing SQLite instead of creating an empty authority', async () => {
  const f = await fixture();
  try {
    assert.throws(
      () => exportMediaCatalogOffline<Row>({ sqlitePath: f.sqlitePath, targetPath: f.targetPath, leasePath: f.leasePath }),
      /MEDIA_CATALOG_EXPORT_SQLITE_MISSING/,
    );
    assert.equal(fs.existsSync(f.sqlitePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});
