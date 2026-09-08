import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { SqliteMediaIndexCatalog, SqlitePhotoXStore } from '@photox/persistence-sqlite';
import { acquireMediaCatalogAuthorityLease, mediaCatalogAuthorityLeaseExists } from './mediaCatalogAuthorityLease.js';
import { restoreMediaCatalogOffline } from './mediaCatalogOfflineRestore.js';

type Row = { workspaceId: string; key: string; filename: string };
type KillPoint = 'backup-created' | 'transaction-started' | 'commit-complete';

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

function readRows(sqlitePath: string): Row[] {
  const store = new SqlitePhotoXStore({ path: sqlitePath });
  try {
    return new SqliteMediaIndexCatalog<Row>(store).listAll();
  } finally {
    store.close();
  }
}

async function waitForRestoreKillPoint(child: ReturnType<typeof spawn>, point: KillPoint): Promise<void> {
  const stdoutStream = child.stdout;
  if (!stdoutStream) throw new Error('restore child stdout unavailable');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`restore child did not reach ${point}`)), 10_000);
    let stdout = '';
    let stderr = '';
    const onData = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (!stdout.includes(`READY:${point}`)) return;
      clearTimeout(timeout);
      stdoutStream.off('data', onData);
      resolve();
    };
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (stdout.includes(`READY:${point}`)) return;
      clearTimeout(timeout);
      reject(new Error(`restore child exited before ${point}: code=${code} signal=${signal} stderr=${stderr}`));
    });
    stdoutStream.on('data', onData);
  });
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('restore child did not exit')), 10_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
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
    assert.deepEqual(readRows(f.sqlitePath), incoming);
    assert.equal(mediaCatalogAuthorityLeaseExists(f.leasePath), false);
  } finally {
    await fsp.rm(f.dir, { recursive: true, force: true });
  }
});

test('offline restore process kill is rollback-or-commit safe at deterministic transaction boundaries', async () => {
  const restoreModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'dist-electron-test/mediaCatalogOfflineRestore.js')).href;
  const script = `
    const { restoreMediaCatalogOffline } = await import(${JSON.stringify(restoreModuleUrl)});
    restoreMediaCatalogOffline({
      sqlitePath: process.argv[1],
      sourcePath: process.argv[2],
      expectedSha256: process.argv[3],
      backupPath: process.argv[4],
      leasePath: process.argv[5],
    });
  `;

  for (const point of ['backup-created', 'transaction-started', 'commit-complete'] as const) {
    const f = await fixture();
    const original: Row[] = [{ workspaceId: 'old', key: 'a', filename: 'old.jpg' }];
    const incoming: Row[] = [
      { workspaceId: 'w1', key: 'a', filename: 'new-a.jpg' },
      { workspaceId: 'w2', key: 'b', filename: 'new-b.jpg' },
    ];
    let child: ReturnType<typeof spawn> | undefined;
    try {
      await seed(f.sqlitePath, original);
      const content = `${JSON.stringify(incoming)}\n`;
      await fsp.writeFile(f.sourcePath, content, 'utf8');
      child = spawn(process.execPath, ['--input-type=module', '-e', script, f.sqlitePath, f.sourcePath, hash(content), f.backupPath, f.leasePath], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PHOTOX_TEST_MEDIA_CATALOG_RESTORE_KILLPOINT: point,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await waitForRestoreKillPoint(child, point);
      assert.ok(child.pid && child.pid > 0);
      assert.deepEqual(JSON.parse(await fsp.readFile(f.backupPath, 'utf8')), original, `${point}: pre-restore backup must be durable before mutation`);
      assert.throws(
        () => acquireMediaCatalogAuthorityLease(f.leasePath, 'desktop-runtime'),
        new RegExp(`MEDIA_CATALOG_AUTHORITY_ACTIVE:operator-restore:${child.pid}`),
      );

      child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
      await waitForChildExit(child);

      const recovered = acquireMediaCatalogAuthorityLease(f.leasePath, 'desktop-runtime');
      recovered.release();
      assert.deepEqual(
        readRows(f.sqlitePath),
        point === 'commit-complete' ? incoming : original,
        `${point}: SQLite must expose only the pre-transaction or fully committed catalog after restart`,
      );
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
        await waitForChildExit(child).catch(() => undefined);
      }
      await fsp.rm(f.dir, { recursive: true, force: true });
    }
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
    assert.deepEqual(readRows(f.sqlitePath), original);
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
    assert.deepEqual(readRows(f.sqlitePath), original);
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
