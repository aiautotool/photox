import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createResumableMediaProductionCommit, type ResumableCommittedMediaRow } from './resumableMediaProductionCommit.js';
import type { ResumableMediaSession } from './resumableMediaIngest.js';

async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-commit-'));
}

function sha256(bytes: Uint8Array) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function session(bytes: number, overrides: Partial<ResumableMediaSession> = {}): ResumableMediaSession {
  return {
    version: 2,
    sessionId: 'upload_test',
    workspaceId: 'workspace-a',
    deviceId: 'device-a',
    actorUserId: 'user-a',
    assetId: 'asset-a',
    filename: 'IMG:unsafe?.jpg',
    mimeType: 'image/jpeg',
    mediaType: 'photo',
    createdAt: Date.UTC(2026, 8, 7, 3, 0, 0),
    expectedBytes: bytes,
    acknowledgedBytes: bytes,
    quotaReservationId: 'reservation-a',
    createdAtIso: '2026-09-07T03:00:00.000Z',
    updatedAtIso: '2026-09-07T03:00:00.000Z',
    expiresAtIso: '2026-09-08T03:00:00.000Z',
    ...overrides,
  };
}

test('copies verified bytes into the library while preserving the authoritative upload part', async () => {
  const root = await tempRoot();
  const incomingRoot = path.join(root, 'incoming');
  const partDir = path.join(incomingRoot, 'resumable');
  const libraryRoot = path.join(root, 'library');
  const journalDir = path.join(root, 'journal');
  await fs.mkdir(partDir, { recursive: true });
  const partPath = path.join(partDir, 'upload_test.part');
  const bytes = Buffer.from('durable resumable media bytes');
  await fs.writeFile(partPath, bytes);
  let ingested: ResumableCommittedMediaRow | undefined;
  let postCommitted = false;

  const commit = createResumableMediaProductionCommit({
    libraryRoot,
    incomingRoot,
    journalDir,
    ingest: async row => { ingested = row; },
    onCommitted: async () => { postCommitted = true; },
    now: () => Date.UTC(2026, 8, 7, 4, 0, 0),
  });

  const result = await commit({
    workspaceId: 'workspace-a',
    key: 'device-a:asset-a',
    session: session(bytes.length),
    partPath,
    sha256: sha256(bytes),
  });

  assert.equal(await fs.readFile(partPath, 'utf8'), bytes.toString('utf8'));
  assert.equal(await fs.readFile(result.target, 'utf8'), bytes.toString('utf8'));
  assert.equal(result.row, ingested);
  assert.equal(result.actorUserId, 'user-a');
  assert.equal(result.row.filename, 'IMG_unsafe_.jpg');
  assert.equal(result.row.path, result.target);
  assert.equal(result.row.size, bytes.length);
  assert.equal(result.row.sha256, sha256(bytes));
  assert.equal(result.row.mediaType, 'photo');
  assert.equal(postCommitted, true);
  assert.deepEqual(await fs.readdir(journalDir), []);
  assert.match(result.target, /2026[\\/]09[\\/]IMG_unsafe_-[a-f0-9]{16}\.jpg$/);
});

test('removes copied target and journal when catalog ingest fails without consuming the upload part', async () => {
  const root = await tempRoot();
  const incomingRoot = path.join(root, 'incoming');
  const partDir = path.join(incomingRoot, 'resumable');
  const libraryRoot = path.join(root, 'library');
  const journalDir = path.join(root, 'journal');
  await fs.mkdir(partDir, { recursive: true });
  const partPath = path.join(partDir, 'upload_test.part');
  const bytes = Buffer.from('retryable media bytes');
  await fs.writeFile(partPath, bytes);

  const commit = createResumableMediaProductionCommit({
    libraryRoot,
    incomingRoot,
    journalDir,
    ingest: async () => { throw new Error('CATALOG_WRITE_FAILED'); },
  });

  await assert.rejects(() => commit({
    workspaceId: 'workspace-a',
    key: 'device-a:asset-a',
    session: session(bytes.length),
    partPath,
    sha256: sha256(bytes),
  }), /CATALOG_WRITE_FAILED/);

  assert.equal(await fs.readFile(partPath, 'utf8'), bytes.toString('utf8'));
  assert.deepEqual(await fs.readdir(journalDir), []);
  const monthDir = path.join(libraryRoot, '2026', '09');
  assert.deepEqual(await fs.readdir(monthDir).catch(() => []), []);
});

test('rejects upload parts outside the managed incoming root before catalog mutation', async () => {
  const root = await tempRoot();
  const incomingRoot = path.join(root, 'incoming');
  const libraryRoot = path.join(root, 'library');
  const journalDir = path.join(root, 'journal');
  const outside = path.join(root, 'outside.part');
  const bytes = Buffer.from('outside');
  await fs.writeFile(outside, bytes);
  let ingestCalled = false;

  const commit = createResumableMediaProductionCommit({
    libraryRoot,
    incomingRoot,
    journalDir,
    ingest: async () => { ingestCalled = true; },
  });

  await assert.rejects(() => commit({
    workspaceId: 'workspace-a',
    key: 'device-a:asset-a',
    session: session(bytes.length),
    partPath: outside,
    sha256: sha256(bytes),
  }), /RECOVERY_TMP_OUTSIDE_INCOMING_ROOT/);
  assert.equal(ingestCalled, false);
  assert.equal(await fs.readFile(outside, 'utf8'), bytes.toString('utf8'));
});

test('queues video post-processing state without allowing post-commit failure to roll back durable media', async () => {
  const root = await tempRoot();
  const incomingRoot = path.join(root, 'incoming');
  const partDir = path.join(incomingRoot, 'resumable');
  await fs.mkdir(partDir, { recursive: true });
  const bytes = Buffer.from('video bytes');
  const partPath = path.join(partDir, 'upload_test.part');
  await fs.writeFile(partPath, bytes);
  const postErrors: unknown[] = [];

  const commit = createResumableMediaProductionCommit({
    libraryRoot: path.join(root, 'library'),
    incomingRoot,
    journalDir: path.join(root, 'journal'),
    ingest: async () => undefined,
    onCommitted: async () => { throw new Error('POST_PROCESSING_FAILED'); },
    onPostCommitError: error => postErrors.push(error),
  });

  const result = await commit({
    workspaceId: 'workspace-a',
    key: 'device-a:asset-a',
    session: session(bytes.length, { mediaType: 'video', mimeType: 'video/quicktime', filename: 'clip.mov' }),
    partPath,
    sha256: sha256(bytes),
  });

  assert.equal(result.row.videoProcessing, 'queued');
  assert.equal(postErrors.length, 1);
  assert.equal(await fs.readFile(result.target, 'utf8'), bytes.toString('utf8'));
  assert.equal(await fs.readFile(partPath, 'utf8'), bytes.toString('utf8'));
});
