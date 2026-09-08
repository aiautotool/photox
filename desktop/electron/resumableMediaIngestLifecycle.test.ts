import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResumableMediaIngestStore } from './resumableMediaIngest.js';
import { createResumableMediaIngestLifecycle } from './resumableMediaIngestLifecycle.js';

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-lifecycle-'));
  const commits: { workspaceId: string; key: string; sha256: string; bytes: Buffer }[] = [];
  const existing = new Set<string>();
  const store = new ResumableMediaIngestStore({ rootDir });
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    exists: async ({ workspaceId, key }) => existing.has(`${workspaceId}\0${key}`),
    commit: async input => {
      const bytes = await fs.readFile(input.partPath);
      commits.push({ workspaceId: input.workspaceId, key: input.key, sha256: input.sha256, bytes });
      existing.add(`${input.workspaceId}\0${input.key}`);
      return { size: bytes.length };
    },
  });
  return { rootDir, commits, existing, store, lifecycle };
}

const principal = { workspaceId: 'ws-a', deviceId: 'device-a' };
const createInput = {
  assetId: 'asset-1',
  filename: 'photo.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'photo' as const,
  createdAt: 1_700_000_000_000,
  expectedBytes: 6,
};

test('resumable lifecycle binds session to authenticated workspace and device', async t => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.rootDir, { recursive: true, force: true }));
  const session = await fx.lifecycle.create(principal, createInput);
  assert.equal(session.workspaceId, principal.workspaceId);
  assert.equal(session.deviceId, principal.deviceId);
  await assert.rejects(() => fx.lifecycle.status({ workspaceId: 'ws-b', deviceId: 'device-a' }, session.sessionId), /UPLOAD_SESSION_BINDING_MISMATCH/);
  await assert.rejects(() => fx.lifecycle.status({ workspaceId: 'ws-a', deviceId: 'device-b' }, session.sessionId), /UPLOAD_SESSION_BINDING_MISMATCH/);
});

test('resumable lifecycle reports durable server acknowledged offset after restart', async t => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.rootDir, { recursive: true, force: true }));
  const session = await fx.lifecycle.create(principal, createInput);
  await fx.lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: Buffer.from('abc') });
  const restarted = createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir: fx.rootDir }),
    exists: async () => false,
    commit: async () => ({ ok: true }),
  });
  const status = await restarted.status(principal, session.sessionId);
  assert.equal(status.acknowledgedBytes, 3);
});

test('finalize verifies whole-file sha256 before commit and removes committed session', async t => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.rootDir, { recursive: true, force: true }));
  const session = await fx.lifecycle.create(principal, createInput);
  const bytes = Buffer.from('abcdef');
  await fx.lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: bytes });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const result = await fx.lifecycle.finalize(principal, { sessionId: session.sessionId, sha256 });
  assert.equal(result.state, 'COMMITTED');
  assert.equal(result.key, 'device-a:asset-1');
  assert.equal(fx.commits.length, 1);
  assert.deepEqual(fx.commits[0]?.bytes, bytes);
  await assert.rejects(() => fx.lifecycle.status(principal, session.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
});

test('sha mismatch fails closed and retains complete session for retry', async t => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.rootDir, { recursive: true, force: true }));
  const session = await fx.lifecycle.create(principal, createInput);
  await fx.lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: Buffer.from('abcdef') });
  await assert.rejects(() => fx.lifecycle.finalize(principal, { sessionId: session.sessionId, sha256: '0'.repeat(64) }), /UPLOAD_SHA256_MISMATCH/);
  assert.equal(fx.commits.length, 0);
  assert.equal((await fx.lifecycle.status(principal, session.sessionId)).acknowledgedBytes, 6);
});

test('duplicate finalize returns already received and consumes upload session', async t => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.rootDir, { recursive: true, force: true }));
  const session = await fx.lifecycle.create(principal, createInput);
  const bytes = Buffer.from('abcdef');
  await fx.lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: bytes });
  fx.existing.add('ws-a\0device-a:asset-1');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const result = await fx.lifecycle.finalize(principal, { sessionId: session.sessionId, sha256 });
  assert.equal(result.state, 'ALREADY_RECEIVED');
  assert.equal(fx.commits.length, 0);
  await assert.rejects(() => fx.lifecycle.status(principal, session.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
});

test('failed commit retains verified session so finalize can be retried', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-lifecycle-failure-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const store = new ResumableMediaIngestStore({ rootDir });
  let attempts = 0;
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    exists: async () => false,
    commit: async () => { attempts += 1; throw new Error('COMMIT_FAILED'); },
  });
  const session = await lifecycle.create(principal, createInput);
  const bytes = Buffer.from('abcdef');
  await lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: bytes });
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await assert.rejects(() => lifecycle.finalize(principal, { sessionId: session.sessionId, sha256 }), /COMMIT_FAILED/);
  assert.equal(attempts, 1);
  assert.equal((await lifecycle.status(principal, session.sessionId)).acknowledgedBytes, 6);
});

test('quota reservation id survives restart and is committed only after media commit', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-quota-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const events: string[] = [];
  const quota = {
    reserve: async () => { events.push('reserve'); return { reservationId: 'quota-1' }; },
    commit: async ({ reservationId }: { reservationId: string }) => { events.push(`commit:${reservationId}`); },
    release: async ({ reservationId, reason }: { reservationId: string; reason: string }) => { events.push(`release:${reservationId}:${reason}`); },
  };
  const first = createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir }),
    quota,
    exists: async () => false,
    commit: async () => ({ ok: true }),
  });
  const session = await first.create(principal, createInput);
  assert.equal(session.quotaReservationId, 'quota-1');
  await first.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: Buffer.from('abcdef') });

  const restarted = createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir }),
    quota,
    exists: async () => false,
    commit: async () => { events.push('media-commit'); return { ok: true }; },
  });
  assert.equal((await restarted.status(principal, session.sessionId)).quotaReservationId, 'quota-1');
  const sha256 = crypto.createHash('sha256').update('abcdef').digest('hex');
  await restarted.finalize(principal, { sessionId: session.sessionId, sha256 });
  assert.deepEqual(events, ['reserve', 'media-commit', 'commit:quota-1']);
});

test('duplicate finalize releases durable quota reservation instead of committing it', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-quota-duplicate-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const events: string[] = [];
  const lifecycle = createResumableMediaIngestLifecycle({
    store: new ResumableMediaIngestStore({ rootDir }),
    quota: {
      reserve: async () => ({ reservationId: 'quota-dup' }),
      commit: async () => { events.push('commit'); },
      release: async ({ reason }) => { events.push(`release:${reason}`); },
    },
    exists: async () => true,
    commit: async () => { throw new Error('SHOULD_NOT_COMMIT'); },
  });
  const session = await lifecycle.create(principal, createInput);
  await lifecycle.appendChunk(principal, { sessionId: session.sessionId, offset: 0, chunk: Buffer.from('abcdef') });
  const sha256 = crypto.createHash('sha256').update('abcdef').digest('hex');
  const result = await lifecycle.finalize(principal, { sessionId: session.sessionId, sha256 });
  assert.equal(result.state, 'ALREADY_RECEIVED');
  assert.deepEqual(events, ['release:duplicate']);
});

test('expired cleanup releases quota reservation before deleting session', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-quota-expired-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let now = 1_700_000_000_000;
  const events: string[] = [];
  const store = new ResumableMediaIngestStore({ rootDir, now: () => now, defaultTtlMs: 1000 });
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    quota: {
      reserve: async () => ({ reservationId: 'quota-expired' }),
      commit: async () => { events.push('commit'); },
      release: async ({ reason }) => { events.push(`release:${reason}`); },
    },
    exists: async () => false,
    commit: async () => ({ ok: true }),
  });
  const session = await lifecycle.create(principal, createInput);
  now += 1001;
  assert.equal(await lifecycle.cleanupExpired(), 1);
  assert.deepEqual(events, ['release:expired']);
  await assert.rejects(() => store.get(session.sessionId), /UPLOAD_SESSION_NOT_FOUND/);
});
