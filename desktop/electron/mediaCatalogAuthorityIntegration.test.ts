import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openActiveMediaCatalogBackend } from './mediaCatalogBackend.js';
import { exportMediaCatalogOffline } from './mediaCatalogOfflineExport.js';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

type Row = RuntimeMediaIndexRow & { filename: string };

test('active Desktop backend owns the same lease used by offline export', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photox-catalog-authority-integration-'));
  const sqlitePath = path.join(dir, 'media-catalog.sqlite');
  const legacyJsonPath = path.join(dir, 'media-index.json');
  const targetPath = path.join(dir, 'rollback.json');
  try {
    await fsp.writeFile(legacyJsonPath, `${JSON.stringify([
      { workspaceId: 'workspace-a', key: 'one', filename: 'one.jpg' },
    ])}\n`, 'utf8');
    const backend = openActiveMediaCatalogBackend<Row>({ sqlitePath, legacyJsonPath });
    assert.throws(
      () => exportMediaCatalogOffline<Row>({ sqlitePath, targetPath }),
      /MEDIA_CATALOG_AUTHORITY_ACTIVE:desktop-runtime/,
    );
    backend.close();

    const result = exportMediaCatalogOffline<Row>({ sqlitePath, targetPath });
    assert.equal(result.exportedCount, 1);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
