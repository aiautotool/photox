import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { ResumableMediaIngestStore } from './resumableMediaIngest.js';
import { createResumableMediaIngestLifecycle } from './resumableMediaIngestLifecycle.js';

const principal = { workspaceId: 'ws-a', deviceId: 'device-a' };
const createInput = {
  assetId: 'asset-1',
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'photo' as const,
  createdAt: 1_700_000_000_000,
  expectedBytes: 6,
};

test('shared ingest coordinator serializes duplicate finalize across independent resumable lifecycles', async t => {
  const rootA = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-shared-coordinator-a-'));
  const rootB = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-shared-coordinator-b-'));
  t.after(async () => {
    await Promise.all([
      fs.rm(rootA, { recursive: true, force: true }),
      fs.rm(rootB, { recursive: true, force: true }),
    ]);
  });

  const coordinator = createMediaIngestCommitCoordinator();
  const existing = new Set<string>();
  const commits: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const firstStartedPromise = new Promise<void>(resolve => { firstStarted = resolve; });

  const makeLifecycle = (rootDir: string, name: string) => createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir }),
    coordinator,
    exists: async ({ workspaceId, key }) => existing.has(`${workspaceId}\0${key}`),
    commit: async input => {
      commits.push(name);
      if (name === 'first') {
        firstStarted();
        await firstGate;
      }
      existing.add(`${input.workspaceId}\0${input.key}`);
      return { name };
    },
  });

  const first = makeLifecycle(rootA, 'first');
  const second = makeLifecycle(rootB, 'second');
  const bytes = Buffer.from('abcdef');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const firstSession = await first.create(principal, createInput);
  const secondSession = await second.create(principal, createInput);
  await first.appendChunk(principal, { sessionId: firstSession.sessionId, offset: 0, chunk: bytes });
  await second.appendChunk(principal, { sessionId: secondSession.sessionId, offset: 0, chunk: bytes });

  const firstFinalize = first.finalize(principal, { sessionId: firstSession.sessionId, sha256 });
  await firstStartedPromise;
  const secondFinalize = second.finalize(principal, { sessionId: secondSession.sessionId, sha256 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(commits, ['first']);
  assert.equal(coordinator.pending(), 1);

  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([firstFinalize, secondFinalize]);
  assert.equal(firstResult.state, 'COMMITTED');
  assert.equal(secondResult.state, 'ALREADY_RECEIVED');
  assert.deepEqual(commits, ['first']);
  assert.equal(coordinator.pending(), 0);
});
