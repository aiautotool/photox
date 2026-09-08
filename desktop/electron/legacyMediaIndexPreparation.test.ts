import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareLegacyMediaIndexForSqlite } from './legacyMediaIndexPreparation.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-legacy-index-'));
  const indexPath = path.join(root, 'media-index.json');
  return { root, indexPath, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('prepares an unscoped legacy index and preserves already-scoped tenant identities', async () => {
  const fx = await fixture();
  try {
    await fs.writeFile(fx.indexPath, JSON.stringify([
      { key: 'legacy-a', filename: 'a.jpg' },
      { workspaceId: 'workspace-other', key: 'other-a', filename: 'b.jpg' },
    ]));

    const result = await prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' });
    assert.equal(result.status, 'MIGRATED');
    const rows = JSON.parse(await fs.readFile(fx.indexPath, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.workspaceId, 'workspace-legacy');
    assert.equal(rows[1]?.workspaceId, 'workspace-other');

    const restart = await prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' });
    assert.equal(restart.status, 'ALREADY_SCOPED');
  } finally {
    await fx.cleanup();
  }
});

test('removes orphaned migration temps left by an interrupted pre-rename run', async () => {
  const fx = await fixture();
  try {
    await fs.writeFile(fx.indexPath, JSON.stringify([{ key: 'a', filename: 'a.jpg' }]));
    const stale = `${fx.indexPath}.crashed-process.migrating`;
    await fs.writeFile(stale, '{"partial":');

    const result = await prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' });
    assert.equal(result.status, 'MIGRATED');
    assert.equal(result.removedStaleTemps, 1);
    await assert.rejects(fs.access(stale));
    const rows = JSON.parse(await fs.readFile(fx.indexPath, 'utf8')) as Array<Record<string, unknown>>;
    assert.equal(rows[0]?.workspaceId, 'workspace-legacy');
  } finally {
    await fx.cleanup();
  }
});

test('fails closed on corrupt or non-array JSON without replacing the source', async () => {
  const fx = await fixture();
  try {
    const corrupt = '[{"key":"a"}';
    await fs.writeFile(fx.indexPath, corrupt);
    await assert.rejects(
      prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' }),
      SyntaxError,
    );
    assert.equal(await fs.readFile(fx.indexPath, 'utf8'), corrupt);

    await fs.writeFile(fx.indexPath, '{"key":"a"}');
    await assert.rejects(
      prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' }),
      /LEGACY_MEDIA_INDEX_ARRAY_REQUIRED/,
    );
  } finally {
    await fx.cleanup();
  }
});

test('treats a missing legacy source as a clean first install', async () => {
  const fx = await fixture();
  try {
    const result = await prepareLegacyMediaIndexForSqlite({ indexPath: fx.indexPath, workspaceId: 'workspace-legacy' });
    assert.deepEqual(result, { status: 'SOURCE_MISSING', migratedRows: 0, removedStaleTemps: 0 });
  } finally {
    await fx.cleanup();
  }
});
