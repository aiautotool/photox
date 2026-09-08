import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMediaIngestRecoveryJournal, recoverDeletionTombstones } from './mediaStartupRecovery.js';

async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-recovery-'));
  const libraryRoot = path.join(root, 'library');
  const incomingRoot = path.join(root, 'incoming');
  const journalDir = path.join(root, 'journals');
  await Promise.all([fs.mkdir(libraryRoot), fs.mkdir(incomingRoot)]);
  return { root, libraryRoot, incomingRoot, journalDir };
}

test('recovery rolls back a crash-left final target not present in the authoritative catalog', async () => {
  const box = await sandbox();
  const journal = createMediaIngestRecoveryJournal(box);
  const tmpPath = path.join(box.incomingRoot, 'upload.part');
  const targetPath = path.join(box.libraryRoot, 'photo-a.jpg');
  await fs.writeFile(tmpPath, 'payload');
  const record = await journal.begin({ workspaceId: 'ws-a', key: 'phone:1', tmpPath, targetPath });
  await fs.rename(tmpPath, targetPath);

  const result = await journal.recover([]);
  assert.deepEqual(result, { scanned: 1, committed: 0, rolledBack: 1, invalid: [] });
  await assert.rejects(fs.access(targetPath));
  await assert.rejects(fs.access(path.join(box.journalDir, `${record.journalId}.json`)));
});

test('recovery keeps a catalog-committed target and only clears its durable journal', async () => {
  const box = await sandbox();
  const journal = createMediaIngestRecoveryJournal(box);
  const tmpPath = path.join(box.incomingRoot, 'upload.part');
  const targetPath = path.join(box.libraryRoot, 'photo-b.jpg');
  await fs.writeFile(tmpPath, 'payload');
  const record = await journal.begin({ workspaceId: 'ws-a', key: 'phone:2', tmpPath, targetPath });
  await fs.rename(tmpPath, targetPath);

  const result = await journal.recover([{ workspaceId: 'ws-a', key: 'phone:2', path: targetPath }]);
  assert.equal(result.committed, 1);
  assert.equal(await fs.readFile(targetPath, 'utf8'), 'payload');
  await assert.rejects(fs.access(path.join(box.journalDir, `${record.journalId}.json`)));
});

test('recovery fails closed for malformed or path-escaping journal entries', async () => {
  const box = await sandbox();
  const journal = createMediaIngestRecoveryJournal(box);
  await fs.mkdir(box.journalDir, { recursive: true });
  const outside = path.join(box.root, 'do-not-delete.txt');
  await fs.writeFile(outside, 'safe');
  await fs.writeFile(path.join(box.journalDir, 'bad.json'), JSON.stringify({
    version: 1,
    journalId: 'bad',
    workspaceId: 'ws-a',
    key: 'phone:3',
    tmpPath: path.join(box.incomingRoot, 'x.part'),
    targetPath: outside,
    createdAt: new Date().toISOString(),
  }));

  const result = await journal.recover([]);
  assert.equal(result.invalid.length, 1);
  assert.equal(await fs.readFile(outside, 'utf8'), 'safe');
  assert.equal((await fs.readdir(box.journalDir)).includes('bad.json'), true);
});

test('begin rejects target and temporary paths outside their managed roots', async () => {
  const box = await sandbox();
  const journal = createMediaIngestRecoveryJournal(box);
  await assert.rejects(
    journal.begin({ workspaceId: 'ws-a', key: 'phone:4', tmpPath: path.join(box.root, 'bad.part'), targetPath: path.join(box.libraryRoot, 'ok.jpg') }),
    /RECOVERY_TMP_OUTSIDE_INCOMING_ROOT/,
  );
  await assert.rejects(
    journal.begin({ workspaceId: 'ws-a', key: 'phone:4', tmpPath: path.join(box.incomingRoot, 'ok.part'), targetPath: path.join(box.root, 'bad.jpg') }),
    /RECOVERY_TARGET_OUTSIDE_LIBRARY_ROOT/,
  );
});

test('restart tombstone recovery resumes only exact deleting rows and isolates failures', async () => {
  const rows = [
    { workspaceId: 'ws-a', key: 'same', path: '/a', deletion: { state: 'deleting' as const, claimId: 'claim-a', startedAt: '2026-01-01T00:00:00.000Z' } },
    { workspaceId: 'ws-b', key: 'same', path: '/b', deletion: { state: 'deleting' as const, claimId: 'claim-b', startedAt: '2026-01-01T00:00:00.000Z' } },
    { workspaceId: 'ws-c', key: 'keep', path: '/c' },
  ];
  const resumed: string[] = [];
  const result = await recoverDeletionTombstones(rows, async row => {
    resumed.push(`${row.workspaceId}:${row.key}`);
    if (row.workspaceId === 'ws-b') throw new Error('provider offline');
  });
  assert.deepEqual(resumed, ['ws-a:same', 'ws-b:same']);
  assert.equal(result.attempted, 2);
  assert.equal(result.recovered, 1);
  assert.deepEqual(result.failures, [{ workspaceId: 'ws-b', key: 'same', error: 'provider offline' }]);
});
