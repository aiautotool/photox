import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyWholeFileOperationsView, type LegacyWholeFileCompatibilityDiagnostics } from './legacyWholeFileOperationsUi.js';

const healthyMonitoring: LegacyWholeFileCompatibilityDiagnostics = {
  initialized: true,
  physicalResumableAcceptance: {
    initialized: true,
    accepted: false,
    releaseCommitSha: 'a'.repeat(40),
    requiredPlatforms: ['ios', 'android'],
    acceptedPlatforms: ['ios'],
    blockers: ['PHYSICAL_RESUMABLE_EVIDENCE_MISSING_ANDROID'],
    evidenceCount: 2,
    persistenceHealthy: true,
    captureMode: 'real-device',
    captureEnabled: true,
    serverAuthorityLedgerInitialized: true,
    serverAuthorityLedgerHealthy: true,
    serverAuthorityRecordCount: 3,
    captureBlockers: [],
  },
  snapshot: {
    observedSince: '2026-09-01T00:00:00.000Z',
    observedUntil: '2026-09-05T00:00:00.000Z',
    total: 8,
    byAuthMode: { bearer: 5, 'pair-code': 2, 'pairing-challenge': 1 },
    byOutcome: { accepted: 5, duplicate: 2, rejected: 1 },
    lastObservedAt: '2026-09-04T00:00:00.000Z',
  },
  deprecationReadiness: {
    ready: false,
    physicalDeviceResumableAccepted: false,
    minimumObservationMs: 7 * 24 * 60 * 60 * 1000,
    observedForMs: 4 * 24 * 60 * 60 * 1000,
    compatibilityRequests: 8,
    blockers: [
      'PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED',
      'OBSERVATION_WINDOW_INCOMPLETE',
      'COMPATIBILITY_TRAFFIC_OBSERVED',
    ],
  },
  persistence: { healthy: true, lastPersistedAt: '2026-09-04T00:00:01.000Z' },
};

test('operations view exposes coarse compatibility counts and readable blockers', () => {
  const view = buildLegacyWholeFileOperationsView(healthyMonitoring);
  assert.equal(view.status, 'monitoring');
  assert.equal(view.total, 8);
  assert.equal(view.bearer, 5);
  assert.equal(view.pairCode, 2);
  assert.equal(view.pairingChallenge, 1);
  assert.equal(view.accepted, 5);
  assert.equal(view.duplicate, 2);
  assert.equal(view.rejected, 1);
  assert.equal(view.observationProgressPercent, 57);
  assert.equal(view.persistenceHealthy, true);
  assert.ok(view.blockerLabels.some(label => label.includes('thiết bị thật')));
  assert.ok(view.blockerLabels.some(label => label.includes('whole-file compatibility route')));
});

test('operations view exposes evidence-derived physical acceptance and controlled capture status read-only', () => {
  const view = buildLegacyWholeFileOperationsView(healthyMonitoring);
  assert.equal(view.physicalEvidenceInitialized, true);
  assert.equal(view.physicalEvidencePersistenceHealthy, true);
  assert.equal(view.physicalEvidenceCount, 2);
  assert.equal(view.physicalReleaseCommitSha, 'a'.repeat(40));
  assert.deepEqual(view.physicalRequiredPlatforms, ['ios', 'android']);
  assert.deepEqual(view.physicalAcceptedPlatforms, ['ios']);
  assert.deepEqual(view.physicalEvidenceBlockers, ['PHYSICAL_RESUMABLE_EVIDENCE_MISSING_ANDROID']);
  assert.equal(view.physicalDeviceResumableAccepted, false);
  assert.equal(view.physicalCaptureMode, 'real-device');
  assert.equal(view.physicalCaptureEnabled, true);
  assert.equal(view.physicalServerAuthorityInitialized, true);
  assert.equal(view.physicalServerAuthorityHealthy, true);
  assert.equal(view.physicalServerAuthorityRecordCount, 3);
  assert.deepEqual(view.physicalCaptureBlockers, []);
});

test('operations view fails closed when telemetry runtime is not initialized', () => {
  const view = buildLegacyWholeFileOperationsView({
    initialized: false,
    deprecationReadiness: {
      ready: false,
      physicalDeviceResumableAccepted: false,
      blockers: ['TELEMETRY_RUNTIME_NOT_INITIALIZED'],
    },
  });
  assert.equal(view.status, 'attention');
  assert.equal(view.persistenceHealthy, false);
  assert.equal(view.total, 0);
  assert.equal(view.physicalDeviceResumableAccepted, false);
  assert.equal(view.physicalEvidenceInitialized, false);
  assert.equal(view.physicalEvidenceCount, 0);
  assert.equal(view.physicalCaptureMode, 'disabled');
  assert.equal(view.physicalCaptureEnabled, false);
  assert.equal(view.physicalServerAuthorityHealthy, true);
  assert.deepEqual(view.blockerLabels, ['Telemetry chưa được khởi tạo']);
});

test('operations view surfaces unhealthy controlled server authority without inventing acceptance', () => {
  const diagnostics: LegacyWholeFileCompatibilityDiagnostics = {
    ...healthyMonitoring,
    physicalResumableAcceptance: {
      ...healthyMonitoring.physicalResumableAcceptance!,
      serverAuthorityLedgerHealthy: false,
      captureBlockers: ['PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_UNHEALTHY'],
    },
  };
  const view = buildLegacyWholeFileOperationsView(diagnostics);
  assert.equal(view.physicalCaptureEnabled, true);
  assert.equal(view.physicalServerAuthorityHealthy, false);
  assert.deepEqual(view.physicalCaptureBlockers, ['PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_UNHEALTHY']);
  assert.equal(view.physicalDeviceResumableAccepted, false);
});

test('operations view never treats unhealthy persistence as retirement-ready', () => {
  const diagnostics: LegacyWholeFileCompatibilityDiagnostics = {
    ...healthyMonitoring,
    initialized: true,
    snapshot: { ...healthyMonitoring.snapshot, total: 0, byAuthMode: { bearer: 0, 'pair-code': 0, 'pairing-challenge': 0 }, byOutcome: { accepted: 0, duplicate: 0, rejected: 0 } },
    deprecationReadiness: {
      ready: false,
      physicalDeviceResumableAccepted: true,
      minimumObservationMs: 100,
      observedForMs: 100,
      compatibilityRequests: 0,
      blockers: ['TELEMETRY_PERSISTENCE_UNHEALTHY'],
    },
    persistence: { healthy: false, lastErrorAt: '2026-09-05T00:00:00.000Z' },
  };
  const view = buildLegacyWholeFileOperationsView(diagnostics);
  assert.equal(view.status, 'attention');
  assert.equal(view.persistenceHealthy, false);
  assert.equal(view.blockerLabels[0], 'Lưu telemetry chưa ổn định');
});

test('operations view reports ready only when runtime readiness is authoritative', () => {
  const diagnostics: LegacyWholeFileCompatibilityDiagnostics = {
    ...healthyMonitoring,
    initialized: true,
    physicalResumableAcceptance: {
      initialized: true,
      accepted: true,
      releaseCommitSha: 'a'.repeat(40),
      requiredPlatforms: ['ios', 'android'],
      acceptedPlatforms: ['ios', 'android'],
      blockers: [],
      evidenceCount: 2,
      persistenceHealthy: true,
      captureMode: 'real-device',
      captureEnabled: true,
      serverAuthorityLedgerInitialized: true,
      serverAuthorityLedgerHealthy: true,
      serverAuthorityRecordCount: 2,
      captureBlockers: [],
    },
    snapshot: { ...healthyMonitoring.snapshot, total: 0, byAuthMode: { bearer: 0, 'pair-code': 0, 'pairing-challenge': 0 }, byOutcome: { accepted: 0, duplicate: 0, rejected: 0 } },
    deprecationReadiness: {
      ready: true,
      physicalDeviceResumableAccepted: true,
      minimumObservationMs: 100,
      observedForMs: 200,
      compatibilityRequests: 0,
      blockers: [],
    },
    persistence: { healthy: true },
  };
  const view = buildLegacyWholeFileOperationsView(diagnostics);
  assert.equal(view.status, 'ready');
  assert.equal(view.observationProgressPercent, 100);
  assert.deepEqual(view.blockers, []);
  assert.deepEqual(view.physicalAcceptedPlatforms, ['ios', 'android']);
});
