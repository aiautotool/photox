import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openActiveMediaCatalogBackend } from './mediaCatalogBackend.js';
import { mediaCatalogDiagnosticsForDesktopOperator, mediaCatalogDiagnosticsForWeb } from './mediaCatalogOperationsTransport.js';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

type Row = RuntimeMediaIndexRow & { filename: string };

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-media-ops-'));
  const sqlitePath = path.join(dir, 'media-catalog.sqlite');
  const legacyJsonPath = path.join(dir, 'media-index.json');
  await fs.writeFile(legacyJsonPath, `${JSON.stringify([
    { workspaceId: 'workspace-a', key: 'one', filename: 'one.jpg' },
  ], null, 2)}\n`, 'utf8');
  return { dir, sqlitePath, legacyJsonPath };
}

test('web media catalog diagnostics require workspace admin and redact local recovery metadata', async () => {
  const f = await fixture();
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    const admin = mediaCatalogDiagnosticsForWeb(backend, { workspaceId: 'workspace-a', workspaceRole: 'admin' });
    assert.equal(admin.rowCount, 1);
    assert.equal(admin.backupAvailable, true);
    assert.equal('backupPath' in admin, false);
    assert.equal('sourceSha256' in admin, false);

    assert.throws(
      () => mediaCatalogDiagnosticsForWeb(backend, { workspaceId: 'workspace-a', workspaceRole: 'member' }),
      /ROLE_FORBIDDEN/,
    );
    assert.throws(
      () => mediaCatalogDiagnosticsForWeb(backend, { workspaceId: 'workspace-a', workspaceRole: 'viewer' }),
      /ROLE_FORBIDDEN/,
    );
    backend.close();
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test('web diagnostics consume live backend health after ingest while local operator can see recovery metadata', async () => {
  const f = await fixture();
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    await backend.writer.ingest({ workspaceId: 'workspace-a', key: 'two', filename: 'two.jpg' });

    const web = mediaCatalogDiagnosticsForWeb(backend, { workspaceId: 'workspace-a', workspaceRole: 'owner' });
    assert.equal(web.rowCount, 2);
    assert.equal('backupPath' in web, false);
    assert.equal('sourceSha256' in web, false);

    const local = mediaCatalogDiagnosticsForDesktopOperator(backend);
    assert.equal(local.rowCount, 2);
    assert.ok(local.backupPath?.endsWith('media-index.pre-sqlite-v1.json'));
    assert.match(local.sourceSha256 ?? '', /^[a-f0-9]{64}$/);
    backend.close();
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});

test('web diagnostics fail closed without workspace identity even for admin role', async () => {
  const f = await fixture();
  try {
    const backend = openActiveMediaCatalogBackend<Row>(f);
    assert.throws(
      () => mediaCatalogDiagnosticsForWeb(backend, { workspaceId: '   ', workspaceRole: 'admin' }),
      /WORKSPACE_REQUIRED/,
    );
    backend.close();
  } finally {
    await fs.rm(f.dir, { recursive: true, force: true });
  }
});
