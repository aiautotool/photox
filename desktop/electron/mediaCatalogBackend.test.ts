import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openActiveMediaCatalogBackend } from './mediaCatalogBackend.js';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

type Row = RuntimeMediaIndexRow & { filename: string };

async function fixture(rows: Row[] | null) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-backend-'));
  const sqlitePath = path.join(dir, 'photox.sqlite');
  const legacyJsonPath = path.join(dir, 'media-index.json');
  if (rows) await fs.writeFile(legacyJsonPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  return { dir, sqlitePath, legacyJsonPath };
}

test('startup backend imports legacy JSON once then exposes sqlite as sole authority', async () => {
  const f = await fixture([
    { workspaceId: 'w1', key: 'same', filename: 'one.jpg' },
    { workspaceId: 'w2', key: 'same', filename: 'two.jpg' },
  ]);
  try {
    const first = openActiveMediaCatalogBackend<Row>(f);
    assert.equal(first.kind, 'sqlite');
    assert.equal(first.health.migrationStatus, 'IMPORTED');
    assert.equal(first.health.rowCount, 2);
    assert.equal(first.health.importedRowCount, 2);
    assert.equal(first.get('w1', 'same')?.filename, 'one.jpg');
    assert.equal(first.get('w2', 'same')?.filename, 'two.jpg');
    await first.writer.ingest({ workspaceId: 'w1', key: 'new', filename: 'new.jpg' });
    assert.equal(first.listWorkspace('w1').length, 2);
    first.close();

    const second = openActiveMediaCatalogBackend<Row>(f);
    assert.equal(second.health.migrationStatus, 'ALREADY_IMPORTED');
    assert.equal(second.health.rowCount, 3);
    assert.equal(second.get('w1', 'new')?.filename, 'new.jpg');
    second.close();
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test('startup backend supports a first install with no legacy JSON', async () => {
  const f = await fixture(null);
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    assert.equal(backend.health.migrationStatus, 'SOURCE_MISSING');
    assert.equal(backend.health.rowCount, 0);
    await backend.writer.ingest({ workspaceId: 'w1', key: 'a', filename: 'a.jpg' });
    assert.equal(backend.get('w1', 'a')?.filename, 'a.jpg');
    backend.close();
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test('startup backend fails closed if legacy source changes after import', async () => {
  const f = await fixture([{ workspaceId: 'w1', key: 'a', filename: 'a.jpg' }]);
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    backend.close();
    await fs.writeFile(f.legacyJsonPath, `${JSON.stringify([
      { workspaceId: 'w1', key: 'a', filename: 'changed.jpg' },
    ], null, 2)}\n`, 'utf8');
    assert.throws(() => openActiveMediaCatalogBackend<Row>(f), /MEDIA_INDEX_MIGRATION_SOURCE_CHANGED/);
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test('startup backend validates migration marker count before activation', async () => {
  const f = await fixture([{ workspaceId: 'w1', key: 'a', filename: 'a.jpg' }]);
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    backend.catalog.remove('w1', 'a');
    backend.close();
    assert.throws(
      () => openActiveMediaCatalogBackend<Row>(f),
      /MEDIA_CATALOG_MIGRATION_COUNT_MISMATCH/,
    );
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
