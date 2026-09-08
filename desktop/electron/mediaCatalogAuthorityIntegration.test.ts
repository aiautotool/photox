import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { acquireMediaCatalogAuthorityLease } from './mediaCatalogAuthorityLease.js';
import { openActiveMediaCatalogBackend } from './mediaCatalogBackend.js';
import { exportMediaCatalogOffline } from './mediaCatalogOfflineExport.js';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

type Row = RuntimeMediaIndexRow & { filename: string };

async function waitForChildReady(child: ReturnType<typeof spawn>): Promise<void> {
  const stdoutStream = child.stdout;
  if (!stdoutStream) throw new Error('child authority holder stdout unavailable');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('child authority holder did not become ready')), 10_000);
    let stdout = '';
    const onData = (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (!stdout.includes('READY')) return;
      clearTimeout(timeout);
      stdoutStream.off('data', onData);
      resolve();
    };
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    stdoutStream.on('data', onData);
  });
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('child authority holder did not exit')), 10_000);
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

test('abruptly terminated authority holder leaves a stale lease that the next process can reclaim', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'photox-catalog-authority-kill-'));
  const leasePath = path.join(dir, 'media-catalog.sqlite.authority.lock');
  const authorityModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'dist-electron-test/mediaCatalogAuthorityLease.js')).href;
  const script = `
    const { acquireMediaCatalogAuthorityLease } = await import(${JSON.stringify(authorityModuleUrl)});
    acquireMediaCatalogAuthorityLease(process.argv[1], 'operator-restore');
    process.stdout.write('READY\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, leasePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForChildReady(child);
    assert.ok(child.pid && child.pid > 0);
    assert.throws(
      () => acquireMediaCatalogAuthorityLease(leasePath, 'desktop-runtime'),
      new RegExp(`MEDIA_CATALOG_AUTHORITY_ACTIVE:operator-restore:${child.pid}`),
    );

    child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
    await waitForChildExit(child);

    const recovered = acquireMediaCatalogAuthorityLease(leasePath, 'desktop-runtime');
    assert.equal(recovered.owner, 'desktop-runtime');
    recovered.release();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
      await waitForChildExit(child).catch(() => undefined);
    }
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
