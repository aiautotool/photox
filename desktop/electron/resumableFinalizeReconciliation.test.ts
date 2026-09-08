import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResumableFinalizeLedger } from './resumableFinalizeLedger.js';
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
const bytes = Buffer.from('abcdef');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');

test('retry after quota failure reconciles durable media commit instead of releasing as duplicate', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-finalize-reconcile-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = new ResumableMediaIngestStore({ rootDir });
  const ledger = new ResumableFinalizeLedger({ rootDir: path.join(rootDir, 'finalize-ledger') });
  const events: string[] = [];
  let failQuotaCommit = true;
  const quota = {
    reserve: async () => ({ reservationId: 'reservation-1' }),
    commit: async () => {
      events.push('quota-commit');
      if (failQuotaCommit) throw new Error('QUOTA_COMMIT_FAILED');
    },
    release: async ({ reason }: { reason: string }) => { events.push(`release:${reason}`); },
  };
  let mediaCommits = 0;
  const first = createResumableMediaIngestLifecycle({
    store,
    finalizeLedger: ledger,
    quota,
    exists: async () => false,
    commit: async () => { mediaCommits += 1; events.push('media-commit'); return { ok: true }; },
  });
  const session = await first.create(principal, createInput);
  await first.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: bytes });
  await assert.rejects(() => first.finalize(principal, { sessionId: session.sessionId, sha256: digest }), /QUOTA_COMMIT_FAILED/);
  assert.equal(mediaCommits, 1);
  assert.ok(await ledger.get(session.sessionId, principal));
  assert.equal((await store.get(session.sessionId, principal)).acknowledgedBytes, bytes.length);

  failQuotaCommit = false;
  const restarted = createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir }),
    finalizeLedger: new ResumableFinalizeLedger({ rootDir: path.join(rootDir, 'finalize-ledger') }),
    quota,
    exists: async () => true,
    commit: async () => { mediaCommits += 1; throw new Error('MEDIA_MUST_NOT_RECOMMIT'); },
  });
  const result = await restarted.finalize(principal, { sessionId: session.sessionId, sha256: digest });
  assert.equal(result.state, 'COMMITTED');
  assert.equal(result.recovered, true);
  assert.equal(mediaCommits, 1);
  assert.deepEqual(events, ['media-commit', 'quota-commit', 'quota-commit']);
  assert.equal(await ledger.get(session.sessionId), null);
  await assert.rejects(() => restarted.status(principal, session.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
});

test('expired cleanup commits quota for media already durably finalized', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-finalize-cleanup-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let now = 1_700_000_000_000;
  const store = new ResumableMediaIngestStore({ rootDir, now: () => now, defaultTtlMs: 1000 });
  const ledger = new ResumableFinalizeLedger({ rootDir: path.join(rootDir, 'finalize-ledger'), now: () => now });
  const events: string[] = [];
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    finalizeLedger: ledger,
    quota: {
      reserve: async () => ({ reservationId: 'reservation-cleanup' }),
      commit: async () => { events.push('commit'); },
      release: async ({ reason }) => { events.push(`release:${reason}`); },
    },
    exists: async () => false,
    commit: async () => ({ ok: true }),
  });
  const session = await lifecycle.create(principal, createInput);
  await lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: bytes });
  await ledger.markCommitted({
    sessionId: session.sessionId,
    workspaceId: principal.workspaceId,
    deviceId: principal.deviceId,
    reservationId: session.quotaReservationId,
    expectedBytes: session.expectedBytes,
    key: 'device-a:asset-1',
    sha256: digest,
  });
  now += 1001;
  assert.equal(await lifecycle.cleanupExpired(), 1);
  assert.deepEqual(events, ['commit']);
  assert.equal(await ledger.get(session.sessionId), null);
  await assert.rejects(() => store.get(session.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
});

test('finalize ledger is idempotent but rejects ownership conflicts', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-finalize-ledger-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const ledger = new ResumableFinalizeLedger({ rootDir });
  const input = {
    sessionId: 'upload-1',
    workspaceId: 'ws-a',
    deviceId: 'device-a',
    reservationId: 'reservation-1',
    expectedBytes: 6,
    key: 'device-a:asset-1',
    sha256: digest,
  };
  const first = await ledger.markCommitted(input);
  const second = await ledger.markCommitted(input);
  assert.deepEqual(second, first);
  await assert.rejects(() => ledger.markCommitted({ ...input, key: 'device-a:asset-2' }), /UPLOAD_FINALIZE_LEDGER_CONFLICT/);
});
