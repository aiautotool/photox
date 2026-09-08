import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMediaCatalogOperationsView, isMediaCatalogRoleDenied } from './mediaCatalogOperationsUi.js';

const diagnostics = {
  kind: 'sqlite' as const,
  schemaVersion: 3,
  migrationStatus: 'ALREADY_IMPORTED',
  rowCount: 42,
  importedRowCount: 30,
  backupAvailable: true,
  backupPath: '/private/photox/media-index.backup.json',
  sourceSha256: 'abc123',
};

test('web operations view redacts operator-only recovery metadata', () => {
  const view = buildMediaCatalogOperationsView(diagnostics, 'web');
  assert.equal(view.backend, 'SQLite');
  assert.equal(view.rowCount, 42);
  assert.equal(view.backupAvailable, true);
  assert.equal(view.recovery, undefined);
  assert.equal(JSON.stringify(view).includes('/private/photox'), false);
  assert.equal(JSON.stringify(view).includes('abc123'), false);
});

test('trusted desktop operations view may expose recovery metadata', () => {
  const view = buildMediaCatalogOperationsView(diagnostics, 'darwin');
  assert.deepEqual(view.recovery, {
    backupPath: '/private/photox/media-index.backup.json',
    sourceSha256: 'abc123',
  });
});

test('role-denied detection recognizes web 403 and explicit role errors', () => {
  assert.equal(isMediaCatalogRoleDenied(new Error('PhotoX Web API 403: ROLE_FORBIDDEN')), true);
  assert.equal(isMediaCatalogRoleDenied(new Error('ROLE_FORBIDDEN')), true);
  assert.equal(isMediaCatalogRoleDenied(new Error('PhotoX Web API 500')), false);
});
