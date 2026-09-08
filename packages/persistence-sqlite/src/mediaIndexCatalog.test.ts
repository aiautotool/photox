import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { SqlitePhotoXStore } from './index.js';
import { SqliteMediaIndexCatalog } from './mediaIndexCatalog.js';

type TestRow = {
  workspaceId: string;
  key: string;
  path: string;
  cloudReplicas?: Array<{ accountId?: string; state: string; remoteFileId?: string }>;
  deletion?: { state: 'deleting'; claimId: string; startedAt: string };
  videoProcessing?: string;
};

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'photox-media-index-'));
  const dbPath = join(dir, 'photox.sqlite3');
  const jsonPath = join(dir, 'media-index.json');
  const backupPath = join(dir, 'media-index.rollback.json');
  const exportPath = join(dir, 'media-index.export.json');
  return { dir, dbPath, jsonPath, backupPath, exportPath };
}

describe('SqliteMediaIndexCatalog', () => {
  it('imports exact tenant identities and preserves opaque runtime metadata', () => {
    const paths = fixture();
    const rows: TestRow[] = [
      {
        workspaceId: 'workspace-a', key: 'same-key', path: '/a.jpg', videoProcessing: 'READY',
        cloudReplicas: [{ accountId: 'drive-a', state: 'VERIFIED', remoteFileId: 'remote-a' }],
      },
      {
        workspaceId: 'workspace-b', key: 'same-key', path: '/b.jpg',
        deletion: { state: 'deleting', claimId: 'claim-b', startedAt: '2026-09-06T00:00:00.000Z' },
      },
    ];
    writeFileSync(paths.jsonPath, JSON.stringify(rows));
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      const result = catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath);
      expect(result.status).toBe('IMPORTED');
      expect(result.importedCount).toBe(2);
      expect(catalog.get('workspace-a', 'same-key')).toEqual(rows[0]);
      expect(catalog.get('workspace-b', 'same-key')).toEqual(rows[1]);
      expect(JSON.parse(readFileSync(paths.backupPath, 'utf8'))).toEqual(rows);
      expect(catalog.getImportMarker()).toMatchObject({ version: 1, importedCount: 2, backupPath: paths.backupPath });
    } finally {
      store.close();
    }
  });

  it('is idempotent for the exact imported source and rejects a changed source', () => {
    const paths = fixture();
    const rows: TestRow[] = [{ workspaceId: 'workspace-a', key: 'asset-a', path: '/a.jpg' }];
    writeFileSync(paths.jsonPath, JSON.stringify(rows));
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      expect(catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath).status).toBe('IMPORTED');
      expect(catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath).status).toBe('ALREADY_IMPORTED');
      expect(catalog.listAll()).toEqual(rows);
      writeFileSync(paths.jsonPath, JSON.stringify([...rows, { workspaceId: 'workspace-a', key: 'asset-b', path: '/b.jpg' }]));
      expect(() => catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath)).toThrow('MEDIA_INDEX_MIGRATION_SOURCE_CHANGED');
      expect(catalog.listAll()).toEqual(rows);
    } finally {
      store.close();
    }
  });

  it('fails closed on duplicate identities without importing any row or marker', () => {
    const paths = fixture();
    writeFileSync(paths.jsonPath, JSON.stringify([
      { workspaceId: 'workspace-a', key: 'asset-a', path: '/a.jpg' },
      { workspaceId: 'workspace-a', key: 'asset-a', path: '/duplicate.jpg' },
    ]));
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      expect(() => catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath)).toThrow('MEDIA_INDEX_MIGRATION_DUPLICATE_IDENTITY');
      expect(catalog.listAll()).toEqual([]);
      expect(catalog.getImportMarker()).toBeNull();
    } finally {
      store.close();
    }
  });

  it('fails closed on corrupt JSON and on a non-empty migration target', () => {
    const paths = fixture();
    writeFileSync(paths.jsonPath, '{not-json');
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      expect(() => catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath)).toThrow('MEDIA_INDEX_MIGRATION_JSON_INVALID');
      expect(catalog.listAll()).toEqual([]);

      catalog.append({ workspaceId: 'workspace-a', key: 'existing', path: '/existing.jpg' });
      writeFileSync(paths.jsonPath, JSON.stringify([{ workspaceId: 'workspace-a', key: 'legacy', path: '/legacy.jpg' }]));
      expect(() => catalog.migrateLegacyJson(paths.jsonPath, paths.backupPath)).toThrow('MEDIA_INDEX_MIGRATION_TARGET_NOT_EMPTY');
      expect(catalog.listAll().map(row => row.key)).toEqual(['existing']);
      expect(catalog.getImportMarker()).toBeNull();
    } finally {
      store.close();
    }
  });

  it('keeps exact identity immutable and exports a rollback-compatible JSON artifact', () => {
    const paths = fixture();
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      catalog.append({ workspaceId: 'workspace-a', key: 'asset-a', path: '/a.jpg' });
      const patched = catalog.patch('workspace-a', 'asset-a', current => ({ ...current, videoProcessing: 'READY' }));
      expect(patched?.videoProcessing).toBe('READY');
      expect(() => catalog.patch('workspace-a', 'asset-a', current => ({ ...current, key: 'asset-b' }))).toThrow('MEDIA_INDEX_IDENTITY_IMMUTABLE');
      expect(catalog.get('workspace-a', 'asset-a')?.key).toBe('asset-a');

      const exported = catalog.exportLegacyJson(paths.exportPath);
      expect(exported.exportedCount).toBe(1);
      expect(JSON.parse(readFileSync(paths.exportPath, 'utf8'))).toEqual([catalog.get('workspace-a', 'asset-a')]);
      expect(exported.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      store.close();
    }
  });

  it('does not confuse identical keys across workspaces during mutation or removal', () => {
    const paths = fixture();
    const store = new SqlitePhotoXStore({ path: paths.dbPath });
    try {
      const catalog = new SqliteMediaIndexCatalog<TestRow>(store);
      catalog.append({ workspaceId: 'workspace-a', key: 'same', path: '/a.jpg' });
      catalog.append({ workspaceId: 'workspace-b', key: 'same', path: '/b.jpg' });
      catalog.patch('workspace-a', 'same', row => ({ ...row, path: '/a2.jpg' }));
      expect(catalog.get('workspace-a', 'same')?.path).toBe('/a2.jpg');
      expect(catalog.get('workspace-b', 'same')?.path).toBe('/b.jpg');
      expect(catalog.remove('workspace-a', 'same')?.workspaceId).toBe('workspace-a');
      expect(catalog.get('workspace-a', 'same')).toBeNull();
      expect(catalog.get('workspace-b', 'same')?.path).toBe('/b.jpg');
    } finally {
      store.close();
    }
  });
});
