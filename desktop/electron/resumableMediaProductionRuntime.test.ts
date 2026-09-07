import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { createResumableMediaProductionRuntime } from './resumableMediaProductionRuntime.js';

type Reservation = { id: string; workspaceId: string; deviceId: string; assetId: string; bytes: number; state: 'reserved' | 'committed' | 'released'; key?: string };

function workspaceRepository() {
  const reservations = new Map<string, Reservation>(); let next = 0;
  return {
    reservations,
    getWorkspace(workspaceId: string) { return workspaceId === 'ws-production' ? { plan: 'personal' as const } : null; },
    getMediaReservation(workspaceId: string, reservationId: string) { const row = reservations.get(reservationId); return row?.workspaceId === workspaceId ? row : null; },
    createMediaReservation(input: { workspaceId: string; deviceId: string; assetId: string; bytes: number }) {
      const row: Reservation = { id: `reservation-${++next}`, workspaceId: input.workspaceId, deviceId: input.deviceId, assetId: input.assetId, bytes: input.bytes, state: 'reserved' };
      reservations.set(row.id, row); return row;
    },
    commitMediaReservation(workspaceId: string, reservationId: string, key: string) {
      const row = reservations.get(reservationId); if (!row || row.workspaceId !== workspaceId) throw new Error('MEDIA_RESERVATION_NOT_FOUND');
      row.state = 'committed'; row.key = key; return row;
    },
    releaseMediaReservationById(workspaceId: string, reservationId: string) {
      const row = reservations.get(reservationId); if (!row || row.workspaceId !== workspaceId) throw new Error('MEDIA_RESERVATION_NOT_FOUND');
      row.state = 'released'; return row;
    },
  };
}

async function withServer(runtime: ReturnType<typeof createResumableMediaProductionRuntime>, run: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(async (req, res) => { if (await runtime.handle(req, res)) return; res.writeHead(404); res.end('not found'); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { runtime.stopCleanup(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

function principal(subject = 'user-production') { return { subject, workspaceId: 'ws-production', deviceId: 'device-production' }; }

test('production runtime binds media:write auth, workspace quota, catalog ingest and post-commit work', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-production-resumable-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const rootDir = path.join(temp, 'uploads'); const incomingRoot = rootDir; const libraryRoot = path.join(temp, 'library'); const journalDir = path.join(temp, 'journal');
  const repo = workspaceRepository(); const rows = new Map<string, { path: string; sha256: string; size: number }>(); const authScopes: string[][] = []; const postCommitted: Array<{ key: string; actorUserId: string }> = [];
  const runtime = createResumableMediaProductionRuntime({
    rootDir, incomingRoot, libraryRoot, journalDir, workspaces: repo, coordinator: createMediaIngestCommitCoordinator(),
    authorizeRequest: async (req, required) => { assert.equal(req.headers.authorization, 'Bearer production-token'); authScopes.push([...required]); return principal(); },
    exists: async ({ workspaceId, key }) => rows.has(`${workspaceId}\0${key}`),
    ingest: async row => { rows.set(`${row.workspaceId}\0${row.key}`, { path: row.path, sha256: row.sha256, size: row.size }); },
    onCommitted: async result => { postCommitted.push({ key: result.row.key, actorUserId: result.actorUserId }); },
  });
  await withServer(runtime, async baseUrl => {
    const bytes = Buffer.from('production-resumable-bytes');
    const create = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'asset-production', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: 1_700_000_000_000, expectedBytes: bytes.length }) });
    assert.equal(create.status, 201); const session = await create.json() as { sessionId: string };
    const chunk = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/chunks`, { method: 'PATCH', headers: { authorization: 'Bearer production-token', 'x-photox-upload-offset': '0' }, body: bytes }); assert.equal(chunk.status, 200);
    const finalize = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/finalize`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ sha256: crypto.createHash('sha256').update(bytes).digest('hex') }) });
    assert.equal(finalize.status, 200); assert.equal((await finalize.json() as { state: string }).state, 'COMMITTED');
    const stored = rows.get('ws-production\0device-production:asset-production'); assert.ok(stored); assert.equal(stored.size, bytes.length); assert.deepEqual(await fs.readFile(stored.path), bytes);
  });
  assert.ok(authScopes.length >= 3); assert.ok(authScopes.every(scopes => scopes.length === 1 && scopes[0] === 'media:write'));
  assert.deepEqual(postCommitted, [{ key: 'device-production:asset-production', actorUserId: 'user-production' }]);
  assert.equal([...repo.reservations.values()].length, 1); assert.equal([...repo.reservations.values()][0]?.state, 'committed'); assert.equal([...repo.reservations.values()][0]?.key, 'device-production:asset-production');
});

test('production runtime rejects a different member even on the same workspace and device', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-production-resumable-member-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const repo = workspaceRepository();
  const runtime = createResumableMediaProductionRuntime({
    rootDir: path.join(temp, 'uploads'), incomingRoot: path.join(temp, 'uploads'), libraryRoot: path.join(temp, 'library'), journalDir: path.join(temp, 'journal'), workspaces: repo, coordinator: createMediaIngestCommitCoordinator(),
    authorizeRequest: async req => principal(req.headers.authorization === 'Bearer member-b' ? 'member-b' : 'member-a'), exists: async () => false, ingest: async () => undefined,
  });
  await withServer(runtime, async baseUrl => {
    const bytes = Buffer.from('member-isolation');
    const create = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { authorization: 'Bearer member-a', 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'asset-member', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: Date.now(), expectedBytes: bytes.length }) });
    assert.equal(create.status, 201); const session = await create.json() as { sessionId: string };
    const denied = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}`, { headers: { authorization: 'Bearer member-b' } });
    assert.equal(denied.status, 403); assert.deepEqual(await denied.json(), { error: 'FORBIDDEN' });
    const chunk = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/chunks`, { method: 'PATCH', headers: { authorization: 'Bearer member-a', 'x-photox-upload-offset': '0' }, body: bytes }); assert.equal(chunk.status, 200);
    const finalize = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/finalize`, { method: 'POST', headers: { authorization: 'Bearer member-a', 'content-type': 'application/json' }, body: JSON.stringify({ sha256: crypto.createHash('sha256').update(bytes).digest('hex') }) });
    assert.equal(finalize.status, 200);
  });
});

test('production runtime normalizes an unsafe durable root under managed incoming storage', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-production-resumable-boundary-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const unsafeRoot = path.join(temp, 'outside-incoming'); const incomingRoot = path.join(temp, 'incoming'); const libraryRoot = path.join(temp, 'library'); const journalDir = path.join(temp, 'journal'); const rows: string[] = []; const repo = workspaceRepository();
  const runtime = createResumableMediaProductionRuntime({ rootDir: unsafeRoot, incomingRoot, libraryRoot, journalDir, workspaces: repo, coordinator: createMediaIngestCommitCoordinator(), authorizeRequest: async () => principal(), exists: async () => false, ingest: async row => { rows.push(row.path); } });
  await withServer(runtime, async baseUrl => {
    const bytes = Buffer.from('managed-boundary');
    const create = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'asset-boundary', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: Date.now(), expectedBytes: bytes.length }) }); assert.equal(create.status, 201); const session = await create.json() as { sessionId: string };
    const chunk = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/chunks`, { method: 'PATCH', headers: { authorization: 'Bearer production-token', 'x-photox-upload-offset': '0' }, body: bytes }); assert.equal(chunk.status, 200);
    const finalize = await fetch(`${baseUrl}/api/v1/media/uploads/${session.sessionId}/finalize`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ sha256: crypto.createHash('sha256').update(bytes).digest('hex') }) }); assert.equal(finalize.status, 200); assert.equal((await finalize.json() as { state: string }).state, 'COMMITTED');
  });
  assert.equal(rows.length, 1); assert.equal(await fs.stat(unsafeRoot).then(() => true, () => false), false); assert.equal(await fs.stat(path.join(incomingRoot, 'resumable')).then(() => true, () => false), true);
});

test('production runtime fails closed when bearer principal has no device binding', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-production-resumable-auth-')); t.after(() => fs.rm(temp, { recursive: true, force: true })); const repo = workspaceRepository();
  const runtime = createResumableMediaProductionRuntime({ rootDir: path.join(temp, 'uploads'), incomingRoot: path.join(temp, 'uploads'), libraryRoot: path.join(temp, 'library'), journalDir: path.join(temp, 'journal'), workspaces: repo, coordinator: createMediaIngestCommitCoordinator(), authorizeRequest: async () => ({ subject: 'user-production', workspaceId: 'ws-production' }), exists: async () => false, ingest: async () => undefined });
  await withServer(runtime, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'asset-production', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: Date.now(), expectedBytes: 4 }) });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
  });
});

test('production runtime fails closed when bearer principal has no user subject', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-production-resumable-user-auth-')); t.after(() => fs.rm(temp, { recursive: true, force: true })); const repo = workspaceRepository();
  const runtime = createResumableMediaProductionRuntime({ rootDir: path.join(temp, 'uploads'), incomingRoot: path.join(temp, 'uploads'), libraryRoot: path.join(temp, 'library'), journalDir: path.join(temp, 'journal'), workspaces: repo, coordinator: createMediaIngestCommitCoordinator(), authorizeRequest: async () => ({ workspaceId: 'ws-production', deviceId: 'device-production' }), exists: async () => false, ingest: async () => undefined });
  await withServer(runtime, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/v1/media/uploads`, { method: 'POST', headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' }, body: JSON.stringify({ assetId: 'asset-production', filename: 'photo.jpg', mimeType: 'image/jpeg', mediaType: 'photo', createdAt: Date.now(), expectedBytes: 4 }) });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'UNAUTHORIZED' });
  });
});
