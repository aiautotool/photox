import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PhysicalResumableServerAuthorityLedger } from './physicalResumableServerAuthority.js';
import type { ResumableMediaSession } from './resumableMediaIngest.js';

const principal = { workspaceId: 'workspace-a', deviceId: 'device-a', actorUserId: 'user-a' };

function session(overrides: Partial<ResumableMediaSession> = {}): ResumableMediaSession {
  return {
    version: 2,
    sessionId: 'upload-a',
    workspaceId: 'workspace-a',
    deviceId: 'device-a',
    actorUserId: 'user-a',
    assetId: 'asset-a',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    mediaType: 'photo',
    createdAt: 1,
    expectedBytes: 100,
    acknowledgedBytes: 0,
    quotaReservationId: 'reservation-a',
    createdAtIso: '2026-09-08T00:00:00.000Z',
    updatedAtIso: '2026-09-08T00:00:00.000Z',
    expiresAtIso: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-authority-'));
  const filePath = path.join(root, 'authority.json');
  let quotaBytes = 1000;
  let catalogRows = 5;
  let now = Date.parse('2026-09-08T01:00:00.000Z');
  const authority = new PhysicalResumableServerAuthorityLedger(filePath, {
    async counters() { return { quotaBytes, catalogRows, observedAt: new Date(now).toISOString() }; },
  }, () => now);
  return {
    root,
    filePath,
    authority,
    setCounters(quota: number, rows: number) { quotaBytes = quota; catalogRows = rows; },
    tick(ms = 1000) { now += ms; },
  };
}

test('persists independent server observations and restores them after restart', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await f.authority.sessionCreated(principal, session());
  f.tick();
  await f.authority.statusObserved(principal, session({ acknowledgedBytes: 40 }));
  f.tick();
  f.setCounters(1100, 6);
  await f.authority.finalized(principal, session({ acknowledgedBytes: 100 }), { state: 'COMMITTED' });

  const restored = new PhysicalResumableServerAuthorityLedger(f.filePath, {
    async counters() { throw new Error('observe must not query mutable counters'); },
  });
  const snapshot = await restored.observe({ ...principal, assetId: 'asset-a', sessionId: 'upload-a', runId: 'run-a' });
  assert.equal(snapshot.offsetAfterRestart.bytes, 40);
  assert.equal(snapshot.finalReceivedBytes, 100);
  assert.equal(snapshot.finalAssetVerified, true);
  assert.equal(snapshot.quotaBefore.bytes, 1000);
  assert.equal(snapshot.quotaAfter.bytes, 1100);
  assert.equal(snapshot.catalogBefore.rows, 5);
  assert.equal(snapshot.catalogAfter.rows, 6);
});

test('authenticated session binding cannot be crossed', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await f.authority.sessionCreated(principal, session());
  await assert.rejects(
    f.authority.statusObserved({ ...principal, deviceId: 'device-b' }, session()),
    /PHYSICAL_RESUMABLE_AUTHORITY_BINDING_MISMATCH/,
  );
  await assert.rejects(
    f.authority.observe({ workspaceId: 'workspace-a', deviceId: 'device-b', assetId: 'asset-a', sessionId: 'upload-a', runId: 'run-b' }),
    /PHYSICAL_RESUMABLE_AUTHORITY_BINDING_MISMATCH/,
  );
});

test('duplicate finalize is never authoritative proof of a newly committed asset', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await f.authority.sessionCreated(principal, session());
  await f.authority.statusObserved(principal, session({ acknowledgedBytes: 40 }));
  f.setCounters(1000, 5);
  await f.authority.finalized(principal, session({ acknowledgedBytes: 100 }), { state: 'ALREADY_RECEIVED' });
  const snapshot = await f.authority.observe({ ...principal, assetId: 'asset-a', sessionId: 'upload-a', runId: 'run-a' });
  assert.equal(snapshot.finalAssetVerified, false);
});

test('corrupt authority ledger fails closed instead of becoming empty trusted state', async t => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(f.filePath), { recursive: true });
  await fs.writeFile(f.filePath, '{broken', 'utf8');
  await assert.rejects(
    f.authority.observe({ ...principal, assetId: 'asset-a', sessionId: 'upload-a', runId: 'run-a' }),
  );
});
