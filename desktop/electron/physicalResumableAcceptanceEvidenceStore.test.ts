import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';
import type { PhysicalResumableAcceptanceEvidence } from './physicalResumableAcceptanceEvidence.js';

function evidence(id: string): PhysicalResumableAcceptanceEvidence {
  return {
    version: 1,
    evidenceId: id,
    recordedAt: '2026-09-08T02:00:00.000Z',
    release: { appVersion: '0.6.0', buildNumber: '600', commitSha: 'abc123' },
    device: { platform: 'ios', model: 'physical-device', osVersion: 'test-os' },
    scenario: {
      assetSizeBytes: 10000,
      interruptedAfterBytes: 4096,
      authoritativeOffsetAfterRestart: 4096,
      resumedFromByte: 4096,
      finalReceivedBytes: 10000,
      finalAssetVerified: true,
      processKilled: true,
      appRestarted: true,
      networkInterrupted: true,
      duplicateQuotaBytes: 0,
      duplicateCatalogRows: 0,
    },
  };
}

test('append persists an immutable evidence record and survives store restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-resumable-evidence-'));
  try {
    const file = path.join(dir, 'evidence.json');
    const firstStore = new PhysicalResumableAcceptanceEvidenceStore(file);
    await firstStore.append(evidence('one'));

    const secondStore = new PhysicalResumableAcceptanceEvidenceStore(file);
    const loaded = await secondStore.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.evidenceId, 'one');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('duplicate evidence ids are rejected instead of overwritten', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-resumable-evidence-'));
  try {
    const store = new PhysicalResumableAcceptanceEvidenceStore(path.join(dir, 'evidence.json'));
    await store.append(evidence('same-id'));
    await assert.rejects(store.append(evidence('same-id')), /EVIDENCE_ID_EXISTS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt persisted ledger fails closed to no accepted evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-resumable-evidence-'));
  try {
    const file = path.join(dir, 'evidence.json');
    await writeFile(file, '{bad-json', 'utf8');
    const store = new PhysicalResumableAcceptanceEvidenceStore(file);
    assert.deepEqual(await store.load(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('persisted ledger contains evidence fields but no mutable accepted flag', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'photox-resumable-evidence-'));
  try {
    const file = path.join(dir, 'evidence.json');
    const store = new PhysicalResumableAcceptanceEvidenceStore(file);
    await store.append(evidence('inspect'));
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /\"evidenceId\": \"inspect\"/);
    assert.doesNotMatch(raw, /\"accepted\"\s*:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
