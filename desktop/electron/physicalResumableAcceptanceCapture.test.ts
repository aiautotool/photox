import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  derivePhysicalResumableEvidenceFromObservedRun,
  PhysicalResumableAcceptanceCaptureWorkflow,
  type PhysicalResumableObservedRun,
} from './physicalResumableAcceptanceCapture.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';

const COMMIT = 'a'.repeat(40);

function passingRun(overrides: Partial<PhysicalResumableObservedRun['scenario']> = {}): PhysicalResumableObservedRun {
  return {
    version: 1,
    runId: 'real-device-ios-run-001',
    startedAt: '2026-09-08T01:00:00.000Z',
    release: { appVersion: '0.6.0', buildNumber: '600', commitSha: COMMIT },
    device: { platform: 'ios', model: 'iPhone 15', osVersion: '18.6' },
    scenario: {
      assetSizeBytes: 10_000,
      quotaBefore: { source: 'workspace-authoritative', bytes: 50_000, observedAt: '2026-09-08T01:00:01.000Z' },
      catalogBefore: { source: 'catalog-authoritative', rows: 20, observedAt: '2026-09-08T01:00:02.000Z' },
      networkInterruptedAt: '2026-09-08T01:00:03.000Z',
      interruptedAfterBytes: 4_096,
      processKilledAt: '2026-09-08T01:00:04.000Z',
      appRestartedAt: '2026-09-08T01:00:05.000Z',
      offsetAfterRestart: { source: 'server-authoritative', bytes: 4_096, observedAt: '2026-09-08T01:00:06.000Z' },
      resumeStartedAt: '2026-09-08T01:00:07.000Z',
      resumedFromByte: 4_096,
      completedAt: '2026-09-08T01:00:08.000Z',
      finalReceivedBytes: 10_000,
      finalAssetVerified: true,
      quotaAfter: { source: 'workspace-authoritative', bytes: 60_000, observedAt: '2026-09-08T01:00:09.000Z' },
      catalogAfter: { source: 'catalog-authoritative', rows: 21, observedAt: '2026-09-08T01:00:10.000Z' },
      ...overrides,
    },
  };
}

test('derives passing evidence from authoritative observed run without an acceptance switch', () => {
  const captured = derivePhysicalResumableEvidenceFromObservedRun(passingRun());
  assert.equal(captured.provesAcceptance, true);
  assert.equal(captured.evidence.scenario.duplicateQuotaBytes, 0);
  assert.equal(captured.evidence.scenario.duplicateCatalogRows, 0);
  assert.equal(captured.evidence.scenario.authoritativeOffsetAfterRestart, 4_096);
  assert.equal(captured.evidence.scenario.resumedFromByte, 4_096);
  assert.equal('accepted' in captured.evidence, false);
});

test('mismatched server offset records failing evidence instead of granting acceptance', () => {
  const captured = derivePhysicalResumableEvidenceFromObservedRun(passingRun({
    offsetAfterRestart: { source: 'server-authoritative', bytes: 3_000, observedAt: '2026-09-08T01:00:06.000Z' },
  }));
  assert.equal(captured.provesAcceptance, false);
  assert.equal(captured.evidence.scenario.authoritativeOffsetAfterRestart, 3_000);
});

test('derives duplicate quota and catalog effects from authoritative before/after snapshots', () => {
  const captured = derivePhysicalResumableEvidenceFromObservedRun(passingRun({
    quotaAfter: { source: 'workspace-authoritative', bytes: 62_500, observedAt: '2026-09-08T01:00:09.000Z' },
    catalogAfter: { source: 'catalog-authoritative', rows: 22, observedAt: '2026-09-08T01:00:10.000Z' },
  }));
  assert.equal(captured.evidence.scenario.duplicateQuotaBytes, 2_500);
  assert.equal(captured.evidence.scenario.duplicateCatalogRows, 1);
  assert.equal(captured.provesAcceptance, false);
});

test('rejects observations whose event chronology is impossible', () => {
  assert.throws(
    () => derivePhysicalResumableEvidenceFromObservedRun(passingRun({
      processKilledAt: '2026-09-08T00:59:59.000Z',
    })),
    /INVALID_PHYSICAL_RESUMABLE_CAPTURE_CHRONOLOGY/,
  );
});

test('rejects snapshots that are not explicitly authoritative', () => {
  const run = passingRun();
  run.scenario.offsetAfterRestart = {
    source: 'server-authoritative',
    bytes: 4_096,
    observedAt: '2026-09-08T01:00:06.000Z',
  };
  (run.scenario.offsetAfterRestart as { source: string }).source = 'client-cache';
  assert.throws(
    () => derivePhysicalResumableEvidenceFromObservedRun(run),
    /INVALID_PHYSICAL_RESUMABLE_CAPTURE_AUTHORITY/,
  );
});

test('workflow appends derived evidence durably and duplicate run ids remain rejected', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'photox-physical-capture-'));
  const filePath = path.join(directory, 'evidence.json');
  const store = new PhysicalResumableAcceptanceEvidenceStore(filePath);
  const workflow = new PhysicalResumableAcceptanceCaptureWorkflow(store);

  const captured = await workflow.appendObservedRun(passingRun());
  assert.equal(captured.provesAcceptance, true);
  assert.equal((await store.load()).length, 1);
  await assert.rejects(
    () => workflow.appendObservedRun(passingRun()),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_EVIDENCE_ID_EXISTS/,
  );

  const persisted = await readFile(filePath, 'utf8');
  assert.equal(persisted.includes('real-device-ios-run-001'), true);
  assert.equal(persisted.includes('accepted'), false);
});
