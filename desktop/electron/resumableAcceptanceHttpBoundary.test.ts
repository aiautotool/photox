import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';
import {
  controlledPhysicalAcceptanceFromEnvironment,
  createResumableMediaProductionRuntime,
} from './resumableMediaProductionRuntime.js';

type Reservation = {
  id: string;
  workspaceId: string;
  deviceId: string;
  assetId: string;
  bytes: number;
  state: 'reserved' | 'committed' | 'released';
  key?: string;
};

const RELEASE_SHA = 'b'.repeat(40);
const BASE_TIME = Date.parse('2026-09-08T10:00:00.000Z');
const ISO = new Date(BASE_TIME).toISOString();

function workspaceRepository() {
  const reservations = new Map<string, Reservation>();
  let next = 0;
  return {
    reservations,
    getWorkspace(workspaceId: string) {
      return workspaceId === 'ws-production' ? { plan: 'personal' as const } : null;
    },
    getUsage(workspaceId: string) {
      return {
        managedStorageBytes: [...reservations.values()]
          .filter(row => row.workspaceId === workspaceId && row.state === 'committed')
          .reduce((total, row) => total + row.bytes, 0),
      };
    },
    getMediaReservation(workspaceId: string, reservationId: string) {
      const row = reservations.get(reservationId);
      return row?.workspaceId === workspaceId ? row : null;
    },
    createMediaReservation(input: { workspaceId: string; deviceId: string; assetId: string; bytes: number }) {
      const row: Reservation = {
        id: `reservation-${++next}`,
        workspaceId: input.workspaceId,
        deviceId: input.deviceId,
        assetId: input.assetId,
        bytes: input.bytes,
        state: 'reserved',
      };
      reservations.set(row.id, row);
      return row;
    },
    commitMediaReservation(workspaceId: string, reservationId: string, key: string) {
      const row = reservations.get(reservationId);
      if (!row || row.workspaceId !== workspaceId) throw new Error('MEDIA_RESERVATION_NOT_FOUND');
      row.state = 'committed';
      row.key = key;
      return row;
    },
    releaseMediaReservationById(workspaceId: string, reservationId: string) {
      const row = reservations.get(reservationId);
      if (!row || row.workspaceId !== workspaceId) throw new Error('MEDIA_RESERVATION_NOT_FOUND');
      row.state = 'released';
      return row;
    },
  };
}

async function withServer(
  runtime: ReturnType<typeof createResumableMediaProductionRuntime>,
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
    runtime.stopCleanup();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function report(assetId = 'asset-authority', sessionId = 'session-authority', runId = 'run-boundary') {
  return {
    version: 1,
    runId,
    startedAt: ISO,
    release: { appVersion: '4.0.0', buildNumber: '400', commitSha: RELEASE_SHA },
    device: { platform: 'android', model: 'Pixel 9', osVersion: '16' },
    upload: { assetId, sessionId, assetSizeBytes: 12 },
    scenario: {
      networkInterruptedAt: new Date(BASE_TIME + 1_000).toISOString(),
      interruptedAfterBytes: 4,
      processKilledAt: new Date(BASE_TIME + 2_000).toISOString(),
      appRestartedAt: new Date(BASE_TIME + 3_000).toISOString(),
      resumeStartedAt: new Date(BASE_TIME + 5_000).toISOString(),
      resumedFromByte: 4,
      completedAt: new Date(BASE_TIME + 6_000).toISOString(),
    },
  };
}

function authorityLedger(overrides: Partial<{
  workspaceId: string;
  deviceId: string;
  assetId: string;
  sessionId: string;
}> = {}) {
  return {
    version: 1,
    records: [{
      version: 1,
      workspaceId: overrides.workspaceId ?? 'ws-production',
      deviceId: overrides.deviceId ?? 'device-production',
      assetId: overrides.assetId ?? 'asset-authority',
      sessionId: overrides.sessionId ?? 'session-authority',
      expectedBytes: 12,
      createdAt: ISO,
      quotaBefore: { bytes: 0, observedAt: ISO },
      catalogBefore: { rows: 0, observedAt: ISO },
      status: [{ bytes: 4, observedAt: new Date(BASE_TIME + 4_000).toISOString() }],
      final: {
        receivedBytes: 12,
        assetVerified: true,
        quotaAfter: { bytes: 12, observedAt: new Date(BASE_TIME + 6_000).toISOString() },
        catalogAfter: { rows: 1, observedAt: new Date(BASE_TIME + 6_000).toISOString() },
        observedAt: new Date(BASE_TIME + 6_000).toISOString(),
      },
    }],
  };
}

async function boundaryRuntime(temp: string) {
  const incomingRoot = path.join(temp, 'incoming');
  const repo = workspaceRepository();
  const exists = async () => false;
  const physicalAcceptance = controlledPhysicalAcceptanceFromEnvironment(
    { incomingRoot, workspaces: repo, exists },
    {
      PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE: 'real-device',
      PHOTOX_RELEASE_COMMIT_SHA: RELEASE_SHA,
    },
  );
  assert.ok(physicalAcceptance);
  return createResumableMediaProductionRuntime({
    rootDir: incomingRoot,
    incomingRoot,
    libraryRoot: path.join(temp, 'library'),
    journalDir: path.join(temp, 'journal'),
    workspaces: repo,
    coordinator: createMediaIngestCommitCoordinator(),
    authorizeRequest: async () => ({
      subject: 'user-production',
      workspaceId: 'ws-production',
      deviceId: 'device-production',
    }),
    exists,
    ingest: async () => undefined,
    physicalAcceptance,
  });
}

async function postAcceptance(baseUrl: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/v1/media/uploads/acceptance`, {
    method: 'POST',
    headers: { authorization: 'Bearer production-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function evidenceCount(temp: string) {
  const store = new PhysicalResumableAcceptanceEvidenceStore(
    path.join(temp, 'physical-resumable-acceptance-evidence.json'),
  );
  return (await store.load()).length;
}

function assertCoarseFailure(result: { status: number; body: Record<string, unknown> }, secrets: string[]) {
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: 'RESUMABLE_UPLOAD_FAILED' });
  const serialized = JSON.stringify(result.body);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false);
}

test('acceptance HTTP fails closed on corrupt server-authority state without evidence mutation or leakage', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-acceptance-http-corrupt-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  await fs.writeFile(path.join(temp, 'physical-resumable-server-authority.json'), '{corrupt', 'utf8');
  const runtime = await boundaryRuntime(temp);
  assert.equal(await evidenceCount(temp), 0);
  await withServer(runtime, async baseUrl => {
    const result = await postAcceptance(baseUrl, report());
    assertCoarseFailure(result, ['ws-production', 'device-production', 'session-authority', 'asset-authority', 'PHYSICAL_RESUMABLE']);
  });
  assert.equal(await evidenceCount(temp), 0);
});

test('acceptance HTTP rejects authenticated authority identity mismatches without evidence mutation or leakage', async t => {
  const cases = [
    {
      name: 'workspace',
      ledger: authorityLedger({ workspaceId: 'ws-other' }),
      request: report(),
      hidden: ['ws-other', 'ws-production'],
    },
    {
      name: 'device',
      ledger: authorityLedger({ deviceId: 'device-other' }),
      request: report(),
      hidden: ['device-other', 'device-production'],
    },
    {
      name: 'session',
      ledger: authorityLedger(),
      request: report('asset-authority', 'session-other', 'run-session-mismatch'),
      hidden: ['session-authority', 'session-other'],
    },
    {
      name: 'asset',
      ledger: authorityLedger(),
      request: report('asset-other', 'session-authority', 'run-asset-mismatch'),
      hidden: ['asset-authority', 'asset-other'],
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), `photox-acceptance-http-${scenario.name}-`));
      try {
        await fs.writeFile(
          path.join(temp, 'physical-resumable-server-authority.json'),
          `${JSON.stringify(scenario.ledger)}\n`,
          'utf8',
        );
        const runtime = await boundaryRuntime(temp);
        assert.equal(await evidenceCount(temp), 0);
        await withServer(runtime, async baseUrl => {
          const result = await postAcceptance(baseUrl, scenario.request);
          assertCoarseFailure(result, [...scenario.hidden, 'PHYSICAL_RESUMABLE']);
        });
        assert.equal(await evidenceCount(temp), 0);
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    });
  }
});
