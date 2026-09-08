import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';
import {
  initializeLegacyWholeFileCompatibilityTelemetry,
  legacyWholeFileCompatibilityDiagnostics,
  resetLegacyWholeFileCompatibilityTelemetryForTests,
} from './legacyWholeFileCompatibilityTelemetryProduction.js';
import type { PhysicalResumableAcceptanceEvidence } from './physicalResumableAcceptanceEvidence.js';

const RELEASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function evidence(platform: 'ios' | 'android'): PhysicalResumableAcceptanceEvidence {
  return {
    version: 1,
    evidenceId: `release-${platform}`,
    recordedAt: '2026-09-08T02:00:00.000Z',
    release: { appVersion: '0.6.0', buildNumber: '600', commitSha: RELEASE_SHA },
    device: { platform, model: 'physical-device', osVersion: 'test-os' },
    scenario: {
      assetSizeBytes: 10_000,
      interruptedAfterBytes: 4_096,
      authoritativeOffsetAfterRestart: 4_096,
      resumedFromByte: 4_096,
      finalReceivedBytes: 10_000,
      finalAssetVerified: true,
      processKilled: true,
      appRestarted: true,
      networkInterrupted: true,
      duplicateQuotaBytes: 0,
      duplicateCatalogRows: 0,
    },
  };
}

test('production readiness derives physical acceptance from exact release evidence only', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-physical-production-'));
  const previousReleaseSha = process.env.PHOTOX_RELEASE_COMMIT_SHA;
  try {
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    process.env.PHOTOX_RELEASE_COMMIT_SHA = RELEASE_SHA;
    const store = new PhysicalResumableAcceptanceEvidenceStore(
      path.join(directory, 'physical-resumable-acceptance-evidence.json'),
    );
    await store.append(evidence('ios'));
    await store.append(evidence('android'));

    await initializeLegacyWholeFileCompatibilityTelemetry(directory);
    const diagnostics = legacyWholeFileCompatibilityDiagnostics();
    assert.equal(diagnostics.initialized, true);
    assert.equal(diagnostics.physicalResumableAcceptance.accepted, true);
    assert.deepEqual(diagnostics.physicalResumableAcceptance.acceptedPlatforms, ['ios', 'android']);
    assert.equal(diagnostics.deprecationReadiness.physicalDeviceResumableAccepted, true);
    assert.equal(diagnostics.deprecationReadiness.blockers.includes('PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED'), false);
  } finally {
    if (previousReleaseSha === undefined) delete process.env.PHOTOX_RELEASE_COMMIT_SHA;
    else process.env.PHOTOX_RELEASE_COMMIT_SHA = previousReleaseSha;
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing release commit identity fails closed even when evidence exists', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'photox-physical-production-'));
  const previousReleaseSha = process.env.PHOTOX_RELEASE_COMMIT_SHA;
  try {
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    delete process.env.PHOTOX_RELEASE_COMMIT_SHA;
    const store = new PhysicalResumableAcceptanceEvidenceStore(
      path.join(directory, 'physical-resumable-acceptance-evidence.json'),
    );
    await store.append(evidence('ios'));
    await store.append(evidence('android'));

    await initializeLegacyWholeFileCompatibilityTelemetry(directory);
    const diagnostics = legacyWholeFileCompatibilityDiagnostics();
    assert.equal(diagnostics.physicalResumableAcceptance.accepted, false);
    assert.ok(diagnostics.physicalResumableAcceptance.blockers.includes('PHYSICAL_RESUMABLE_RELEASE_COMMIT_SHA_MISSING'));
    assert.equal(diagnostics.deprecationReadiness.physicalDeviceResumableAccepted, false);
    assert.ok(diagnostics.deprecationReadiness.blockers.includes('PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED'));
  } finally {
    if (previousReleaseSha === undefined) delete process.env.PHOTOX_RELEASE_COMMIT_SHA;
    else process.env.PHOTOX_RELEASE_COMMIT_SHA = previousReleaseSha;
    resetLegacyWholeFileCompatibilityTelemetryForTests();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
