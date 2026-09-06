import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaCatalogDiagnostics } from './mediaCatalogDiagnostics.js';
import type { MediaCatalogBackendHealth } from './mediaCatalogBackend.js';

const health: MediaCatalogBackendHealth = {
  kind: 'sqlite',
  schemaVersion: 1,
  migrationStatus: 'ALREADY_IMPORTED',
  rowCount: 42,
  importedRowCount: 40,
  backupPath: '/private/user/data/media-index.pre-sqlite-v1.json',
  sourceSha256: 'abc123-secret-fingerprint',
};

test('workspace catalog diagnostics redact host filesystem and source fingerprint', () => {
  const diagnostics = mediaCatalogDiagnostics(health, 'workspace');
  assert.deepEqual(diagnostics, {
    kind: 'sqlite',
    schemaVersion: 1,
    migrationStatus: 'ALREADY_IMPORTED',
    rowCount: 42,
    importedRowCount: 40,
    backupAvailable: true,
  });
  assert.equal('backupPath' in diagnostics, false);
  assert.equal('sourceSha256' in diagnostics, false);
});

test('operator catalog diagnostics retain recovery metadata', () => {
  const diagnostics = mediaCatalogDiagnostics(health, 'operator');
  assert.equal(diagnostics.backupPath, health.backupPath);
  assert.equal(diagnostics.sourceSha256, health.sourceSha256);
  assert.equal(diagnostics.backupAvailable, true);
});

test('diagnostics report missing rollback artifact without inventing a path', () => {
  const diagnostics = mediaCatalogDiagnostics({
    ...health,
    migrationStatus: 'SOURCE_MISSING',
    backupPath: undefined,
    sourceSha256: undefined,
  }, 'workspace');
  assert.equal(diagnostics.backupAvailable, false);
  assert.equal('backupPath' in diagnostics, false);
});
