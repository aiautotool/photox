import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PickedMediaItem } from '@photosync/google-photos';
import { GooglePhotosMigrationSpool } from './googlePhotosMigrationSpool.js';

function picked(id: string, filename = `${id}.jpg`): PickedMediaItem {
  return {
    id,
    type: 'PHOTO',
    createTime: '2026-09-05T00:00:00.000Z',
    mediaFile: {
      baseUrl: `https://picker.example.invalid/${id}`,
      mimeType: 'image/jpeg',
      filename,
    },
  } as PickedMediaItem;
}

async function descendants(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else result.push(target);
    }
  }
  await walk(root);
  return result;
}

test('migration spool stages Picker media without persisting session-bound base URLs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-migration-spool-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const spool = new GooglePhotosMigrationSpool(root, 'workspace-a');
  const items = [picked('media-a'), picked('media-b', 'holiday.jpg')];

  const staged = await spool.stage('job-1', items, async item => new Response(`bytes:${item.id}`, {
    headers: { 'content-type': 'image/jpeg' },
  }));

  assert.deepEqual(staged.map(item => item.sourceMediaId), ['media-a', 'media-b']);
  assert.equal(staged[0]?.sizeBytes, Buffer.byteLength('bytes:media-a'));
  assert.match(staged[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);

  const files = await descendants(root);
  const manifestPath = files.find(file => file.endsWith('manifest.json'));
  assert.ok(manifestPath);
  const manifestText = await fs.readFile(manifestPath, 'utf8');
  assert.equal(manifestText.includes('picker.example.invalid'), false);
  assert.equal(manifestText.includes('baseUrl'), false);

  const restored = await spool.sourceMap('job-1');
  assert.equal(restored.get('media-a')?.mediaFile?.baseUrl, '');
  assert.equal(restored.get('media-b')?.mediaFile?.filename, 'holiday.jpg');

  const response = await spool.response('job-1', 'media-a');
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength('bytes:media-a')));
  assert.equal(await response.text(), 'bytes:media-a');
});

test('migration spool is workspace scoped even when job IDs collide', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-migration-spool-scope-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const workspaceA = new GooglePhotosMigrationSpool(root, 'workspace-a');
  const workspaceB = new GooglePhotosMigrationSpool(root, 'workspace-b');

  await workspaceA.stage('same-job', [picked('media-a')], async () => new Response('workspace-a'));
  await assert.rejects(() => workspaceB.list('same-job'), /MIGRATION_SPOOL_MISSING/);
  assert.equal(await (await workspaceA.response('same-job', 'media-a')).text(), 'workspace-a');
});

test('migration spool rejects duplicate source IDs and removes partial staging data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-migration-spool-duplicate-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const spool = new GooglePhotosMigrationSpool(root, 'workspace-a');

  await assert.rejects(
    () => spool.stage('job-duplicate', [picked('same'), picked('same')], async () => new Response('bytes')),
    /MIGRATION_SPOOL_INVALID_SOURCE/,
  );
  await assert.rejects(() => spool.list('job-duplicate'), /MIGRATION_SPOOL_MISSING/);
});

test('migration spool detects byte tampering before returning transfer response', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-migration-spool-tamper-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const spool = new GooglePhotosMigrationSpool(root, 'workspace-a');

  await spool.stage('job-tamper', [picked('media-a')], async () => new Response('original-bytes'));
  const files = await descendants(root);
  const mediaPath = files.find(file => file.endsWith('.bin'));
  assert.ok(mediaPath);
  await fs.writeFile(mediaPath, 'tampered-data!');

  await assert.rejects(() => spool.response('job-tamper', 'media-a'), /MIGRATION_SPOOL_INTEGRITY_FAILED/);
});

test('migration spool validates manifest item structure before use', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-migration-spool-manifest-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  const spool = new GooglePhotosMigrationSpool(root, 'workspace-a');

  await spool.stage('job-manifest', [picked('media-a')], async () => new Response('bytes'));
  const files = await descendants(root);
  const manifestPath = files.find(file => file.endsWith('manifest.json'));
  assert.ok(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.items[0].sha256 = '../../not-a-hash';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(() => spool.list('job-manifest'), /MIGRATION_SPOOL_INVALID/);
});
