import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MediaCloudCatalog } from '@photox/media-cloud';
import { SqliteMediaCloudRepository, SqlitePhotoXStore } from './index.js';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'photox-media-cloud-'));
  tempDirs.push(dir);
  return new SqlitePhotoXStore({ path: join(dir, 'photox.db') });
}

describe('SqliteMediaCloudRepository workspace isolation', () => {
  it('stores identical asset IDs independently and keeps isolation after reopen', async () => {
    const store = await makeStore();
    const dbPath = store.db.prepare('PRAGMA database_list').get() as { file: string };
    const repository = new SqliteMediaCloudRepository(store, 'legacy-workspace');
    const workspaceA = new MediaCloudCatalog(repository, 'workspace-a');
    const workspaceB = new MediaCloudCatalog(repository, 'workspace-b');

    await workspaceA.registerAsset({ assetId: 'same-asset', filename: 'a.jpg', sizeBytes: 100 });
    await workspaceB.registerAsset({ assetId: 'same-asset', filename: 'b.jpg', sizeBytes: 200 });
    expect((await workspaceA.get('same-asset'))?.filename).toBe('a.jpg');
    expect((await workspaceB.get('same-asset'))?.filename).toBe('b.jpg');
    store.close();

    const reopened = new SqlitePhotoXStore({ path: dbPath.file });
    const reopenedRepository = new SqliteMediaCloudRepository(reopened, 'legacy-workspace');
    const reopenedA = new MediaCloudCatalog(reopenedRepository, 'workspace-a');
    const reopenedB = new MediaCloudCatalog(reopenedRepository, 'workspace-b');
    expect((await reopenedA.list()).map((row) => row.filename)).toEqual(['a.jpg']);
    expect((await reopenedB.list()).map((row) => row.filename)).toEqual(['b.jpg']);
    await reopenedA.remove('same-asset');
    expect(await reopenedA.get('same-asset')).toBeNull();
    expect((await reopenedB.get('same-asset'))?.filename).toBe('b.jpg');
    reopened.close();
  });

  it('migrates legacy unscoped rows into only the designated legacy workspace', async () => {
    const store = await makeStore();
    const legacyItem = {
      assetId: 'legacy-asset', filename: 'legacy.jpg', sizeBytes: 321, updatedAt: '2026-01-01T00:00:00.000Z', targetReplicas: 2, replicas: [],
    };
    store.db.prepare('INSERT INTO photox_media_cloud(asset_id,filename,item_json,updated_at) VALUES(?,?,?,?)').run(
      legacyItem.assetId, legacyItem.filename, JSON.stringify(legacyItem), legacyItem.updatedAt,
    );

    const repository = new SqliteMediaCloudRepository(store, 'legacy-workspace');
    const legacyCatalog = new MediaCloudCatalog(repository, 'legacy-workspace');
    const otherCatalog = new MediaCloudCatalog(repository, 'other-workspace');
    expect((await legacyCatalog.get('legacy-asset'))?.workspaceId).toBe('legacy-workspace');
    expect(await otherCatalog.get('legacy-asset')).toBeNull();

    const columns = store.db.prepare('PRAGMA table_info(photox_media_cloud)').all() as Array<{ name: string; pk: number }>;
    expect(columns.find((column) => column.name === 'workspace_id')?.pk).toBeGreaterThan(0);
    expect(columns.find((column) => column.name === 'asset_id')?.pk).toBeGreaterThan(0);
    store.close();
  });
});
