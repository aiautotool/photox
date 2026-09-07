import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createResumableMediaReceiverRuntime } from './resumableMediaReceiverRuntime.js';

const principal = { workspaceId: 'ws-runtime', deviceId: 'device-runtime' };

function quota(events: string[]) {
  let next = 0;
  return {
    async reserve() {
      next += 1;
      const reservationId = `reservation-${next}`;
      events.push(`reserve:${reservationId}`);
      return { reservationId };
    },
    async commit({ reservationId }: { reservationId: string }) {
      events.push(`commit:${reservationId}`);
    },
    async release({ reservationId, reason }: { reservationId: string; reason: 'duplicate' | 'expired' | 'create_failed' }) {
      events.push(`release:${reservationId}:${reason}`);
    },
  };
}

async function withServer(
  runtime: ReturnType<typeof createResumableMediaReceiverRuntime>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = http.createServer(async (req, res) => {
    if (await runtime.handle(req, res)) return;
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

async function createSession(baseUrl: string, expectedBytes = 6) {
  const response = await fetch(`${baseUrl}/api/v1/media/uploads`, {
    method: 'POST',
    headers: { authorization: 'Bearer runtime-test', 'content-type': 'application/json' },
    body: JSON.stringify({
      assetId: 'asset-1',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      mediaType: 'photo',
      createdAt: 1_700_000_000_000,
      expectedBytes,
    }),
  });
  assert.equal(response.status, 201);
  return await response.json() as { sessionId: string; acknowledgedBytes: number; expectedBytes: number };
}

test('receiver runtime composes auth, durable offset and verified final commit', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-runtime-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const events: string[] = [];
  const committed: Buffer[] = [];
  const existing = new Set<string>();
  const runtime = createResumableMediaReceiverRuntime({
    rootDir,
    authorize: async req => {
      assert.equal(req.headers.authorization, 'Bearer runtime-test');
      return principal;
    },
    exists: async ({ workspaceId, key }) => existing.has(`${workspaceId}\0${key}`),
    commit: async input => {
      const bytes = await fs.readFile(input.partPath);
      committed.push(bytes);
      existing.add(`${input.workspaceId}\0${input.key}`);
      events.push('media-commit');
      return { bytes: bytes.length };
    },
    quota: quota(events),
  });

  await withServer(runtime, async baseUrl => {
    const session = await createSession(baseUrl);
    assert.equal(session.acknowledgedBytes, 0);
    const first = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/chunks`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer runtime-test', 'x-photox-upload-offset': '0' },
      body: Buffer.from('abc'),
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json() as { acknowledgedBytes: number }).acknowledgedBytes, 3);
  });

  const restarted = createResumableMediaReceiverRuntime({
    rootDir,
    authorize: async () => principal,
    exists: async ({ workspaceId, key }) => existing.has(`${workspaceId}\0${key}`),
    commit: async input => {
      const bytes = await fs.readFile(input.partPath);
      committed.push(bytes);
      existing.add(`${input.workspaceId}\0${input.key}`);
      events.push('media-commit');
      return { bytes: bytes.length };
    },
    quota: quota(events),
  });

  await withServer(restarted, async baseUrl => {
    const files = (await fs.readdir(rootDir)).filter(name => name.endsWith('.json'));
    assert.equal(files.length, 1);
    const sessionId = files[0]!.slice(0, -'.json'.length);
    const status = await fetch(`${baseUrl}/api/v1/media/uploads/${sessionId}`, {
      headers: { authorization: 'Bearer runtime-test' },
    });
    assert.equal(status.status, 200);
    assert.equal((await status.json() as { acknowledgedBytes: number }).acknowledgedBytes, 3);

    const second = await fetch(`${baseUrl}/api/v1/media/uploads/${sessionId}/chunks`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer runtime-test', 'x-photox-upload-offset': '3' },
      body: Buffer.from('def'),
    });
    assert.equal(second.status, 200);
    assert.equal((await second.json() as { acknowledgedBytes: number }).acknowledgedBytes, 6);

    const sha256 = crypto.createHash('sha256').update('abcdef').digest('hex');
    const final = await fetch(`${baseUrl}/api/v1/media/uploads/${sessionId}/finalize`, {
      method: 'POST',
      headers: { authorization: 'Bearer runtime-test', 'content-type': 'application/json' },
      body: JSON.stringify({ sha256 }),
    });
    assert.equal(final.status, 200);
    assert.equal((await final.json() as { state: string }).state, 'COMMITTED');
  });

  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0], Buffer.from('abcdef'));
  assert.deepEqual(events.filter(event => event === 'media-commit'), ['media-commit']);
  assert.ok(events.some(event => event.startsWith('commit:reservation-')));
});

test('receiver runtime cleanup is single-flight and releases expired reservation', async t => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-resumable-runtime-expiry-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let now = 1_700_000_000_000;
  const events: string[] = [];
  const runtime = createResumableMediaReceiverRuntime({
    rootDir,
    authorize: async () => principal,
    exists: async () => false,
    commit: async () => ({ ok: true }),
    quota: quota(events),
    sessionTtlMs: 1_000,
    cleanupIntervalMs: 60_000,
    now: () => now,
  });

  await withServer(runtime, async baseUrl => {
    await createSession(baseUrl);
  });
  now += 1_001;
  const [a, b] = await Promise.all([runtime.cleanupExpired(), runtime.cleanupExpired()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.ok(events.some(event => event.endsWith(':expired')));
  assert.deepEqual((await fs.readdir(rootDir)).filter(name => name.endsWith('.json') || name.endsWith('.part')), []);
});

test('receiver runtime rejects invalid cleanup and chunk configuration before serving', async () => {
  const common = {
    rootDir: '/tmp/not-used',
    authorize: async () => principal,
    exists: async () => false,
    commit: async () => ({ ok: true }),
    quota: quota([]),
  };
  assert.throws(() => createResumableMediaReceiverRuntime({ ...common, cleanupIntervalMs: 0 }), /INVALID_RESUMABLE_CLEANUP_INTERVAL_MS/);
  assert.throws(() => createResumableMediaReceiverRuntime({ ...common, maxChunkBytes: 0 }), /INVALID_RESUMABLE_MAX_CHUNK_BYTES/);
});
