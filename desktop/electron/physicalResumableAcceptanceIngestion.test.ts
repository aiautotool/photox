import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PhysicalResumableAcceptanceCaptureWorkflow } from './physicalResumableAcceptanceCapture.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';
import {
  PhysicalResumableAcceptanceIngestion,
  validateMobilePhysicalResumableAcceptanceReport,
  type MobilePhysicalResumableAcceptanceReport,
} from './physicalResumableAcceptanceIngestion.js';

const commitSha = 'a'.repeat(40);

function mobileReport(): MobilePhysicalResumableAcceptanceReport {
  return {
    version: 1,
    runId: 'run-ios-1',
    startedAt: '2026-09-08T01:00:00.000Z',
    release: { appVersion: '0.6.0', buildNumber: '86', commitSha },
    device: { platform: 'ios', model: 'iPhone17,1', osVersion: '19.0' },
    upload: { assetId: 'asset-1', sessionId: 'session-1', assetSizeBytes: 100 },
    scenario: {
      networkInterruptedAt: '2026-09-08T01:00:03.000Z',
      interruptedAfterBytes: 40,
      processKilledAt: '2026-09-08T01:00:04.000Z',
      appRestartedAt: '2026-09-08T01:00:05.000Z',
      resumeStartedAt: '2026-09-08T01:00:07.000Z',
      resumedFromByte: 40,
      completedAt: '2026-09-08T01:00:09.000Z',
    },
  };
}

function authoritativeSnapshot() {
  return {
    offsetAfterRestart: { bytes: 40, observedAt: '2026-09-08T01:00:06.000Z' },
    finalReceivedBytes: 100,
    finalAssetVerified: true,
    quotaBefore: { bytes: 1000, observedAt: '2026-09-08T01:00:01.000Z' },
    quotaAfter: { bytes: 1100, observedAt: '2026-09-08T01:00:10.000Z' },
    catalogBefore: { rows: 10, observedAt: '2026-09-08T01:00:02.000Z' },
    catalogAfter: { rows: 11, observedAt: '2026-09-08T01:00:11.000Z' },
  };
}

test('mobile report rejects any attempt to provide server/quota/catalog authority fields', () => {
  const base = mobileReport();
  for (const [name, value] of Object.entries({
    offsetAfterRestart: { source: 'server-authoritative', bytes: 100, observedAt: base.scenario.appRestartedAt },
    quotaBefore: { source: 'workspace-authoritative', bytes: 0, observedAt: base.startedAt },
    catalogAfter: { source: 'catalog-authoritative', rows: 0, observedAt: base.scenario.completedAt },
    finalAssetVerified: true,
    duplicateQuotaBytes: 0,
  })) {
    const report = structuredClone(base) as unknown as Record<string, unknown>;
    (report.scenario as Record<string, unknown>)[name] = value;
    assert.throws(
      () => validateMobilePhysicalResumableAcceptanceReport(report),
      /INVALID_MOBILE_RESUMABLE_ACCEPTANCE_SCENARIO/,
      name,
    );
  }
});

test('ingestion binds authority lookup to authenticated workspace/device and persists only server-derived proof', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-physical-ingestion-'));
  try {
    const store = new PhysicalResumableAcceptanceEvidenceStore(path.join(dir, 'evidence.json'));
    const capture = new PhysicalResumableAcceptanceCaptureWorkflow(store);
    const authorityCalls: unknown[] = [];
    const ingestion = new PhysicalResumableAcceptanceIngestion({
      async observe(input) {
        authorityCalls.push(input);
        return authoritativeSnapshot();
      },
    }, capture);

    const captured = await ingestion.ingest({
      workspaceId: 'workspace-authoritative-1',
      deviceId: 'device-authoritative-1',
      report: mobileReport(),
    });

    assert.equal(captured.provesAcceptance, true);
    assert.deepEqual(authorityCalls, [{
      workspaceId: 'workspace-authoritative-1',
      deviceId: 'device-authoritative-1',
      assetId: 'asset-1',
      sessionId: 'session-1',
      runId: 'run-ios-1',
    }]);
    assert.equal(captured.evidence.scenario.authoritativeOffsetAfterRestart, 40);
    assert.equal(captured.evidence.scenario.duplicateQuotaBytes, 0);
    assert.equal(captured.evidence.scenario.duplicateCatalogRows, 0);
    assert.equal(captured.evidence.scenario.finalAssetVerified, true);
    const persisted = await store.load();
    assert.equal(persisted.length, 1);
    const serialized = JSON.stringify(persisted[0]);
    assert.equal(serialized.includes('workspace-authoritative-1'), false);
    assert.equal(serialized.includes('device-authoritative-1'), false);
    assert.equal(serialized.includes('session-1'), false);
    assert.equal(serialized.includes('asset-1'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ingestion refuses an unbound mobile artifact before querying authority', async () => {
  let queried = false;
  const ingestion = new PhysicalResumableAcceptanceIngestion({
    async observe() {
      queried = true;
      return authoritativeSnapshot();
    },
  }, {} as PhysicalResumableAcceptanceCaptureWorkflow);

  await assert.rejects(
    ingestion.ingest({ workspaceId: '', deviceId: 'device-1', report: mobileReport() }),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_AUTH_BINDING_REQUIRED/,
  );
  assert.equal(queried, false);
});
