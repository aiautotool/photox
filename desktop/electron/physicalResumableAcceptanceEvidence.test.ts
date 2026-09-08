import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluatePhysicalResumableAcceptance,
  evidenceProvesPhysicalResumableAcceptance,
  parsePhysicalResumableAcceptanceEvidence,
  type PhysicalResumableAcceptanceEvidence,
} from './physicalResumableAcceptanceEvidence.js';

function evidence(platform: 'ios' | 'android', commitSha = 'abc123'): PhysicalResumableAcceptanceEvidence {
  return {
    version: 1,
    evidenceId: `${platform}-evidence`,
    recordedAt: '2026-09-08T02:00:00.000Z',
    release: {
      appVersion: '0.6.0',
      buildNumber: '600',
      commitSha,
    },
    device: {
      platform,
      model: platform === 'ios' ? 'iPhone physical device' : 'Android physical device',
      osVersion: 'test-os',
    },
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

test('requires valid physical evidence for both mobile platforms by default', () => {
  const result = evaluatePhysicalResumableAcceptance([evidence('ios')], { releaseCommitSha: 'abc123' });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.acceptedPlatforms, ['ios']);
  assert.deepEqual(result.blockers, ['PHYSICAL_RESUMABLE_EVIDENCE_MISSING_ANDROID']);
});

test('accepts only when both platform records prove the exact resumable scenario', () => {
  const ios = evidence('ios');
  const android = evidence('android');
  const result = evaluatePhysicalResumableAcceptance([ios, android], { releaseCommitSha: 'abc123' });
  assert.equal(result.accepted, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.evidenceIds, ['ios-evidence', 'android-evidence']);
});

test('does not let stale release evidence authorize a new release', () => {
  const result = evaluatePhysicalResumableAcceptance([
    evidence('ios', 'old-release'),
    evidence('android', 'old-release'),
  ], { releaseCommitSha: 'new-release' });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.acceptedPlatforms, []);
});

test('rejects a restart that does not resume from authoritative server offset', () => {
  const invalid = evidence('ios');
  invalid.scenario.resumedFromByte = invalid.scenario.authoritativeOffsetAfterRestart + 1;
  assert.equal(evidenceProvesPhysicalResumableAcceptance(invalid), false);
});

test('rejects duplicate quota or catalog side effects', () => {
  const quotaDuplicate = evidence('ios');
  quotaDuplicate.scenario.duplicateQuotaBytes = 1;
  assert.equal(evidenceProvesPhysicalResumableAcceptance(quotaDuplicate), false);

  const catalogDuplicate = evidence('android');
  catalogDuplicate.scenario.duplicateCatalogRows = 1;
  assert.equal(evidenceProvesPhysicalResumableAcceptance(catalogDuplicate), false);
});

test('parser fails closed for malformed evidence', () => {
  const invalid = evidence('ios') as unknown as Record<string, unknown>;
  invalid.recordedAt = 'not-a-date';
  assert.equal(parsePhysicalResumableAcceptanceEvidence(invalid), undefined);
});
