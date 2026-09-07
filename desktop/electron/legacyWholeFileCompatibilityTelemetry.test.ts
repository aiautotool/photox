import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyWholeFileCompatibilityTelemetry } from './legacyWholeFileCompatibilityTelemetry.js';

test('records only coarse whole-file compatibility usage by auth mode and outcome', () => {
  let now = Date.parse('2026-09-08T00:00:00.000Z');
  const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 1000 });
  telemetry.record({ authMode: 'bearer', outcome: 'accepted' });
  now += 10;
  telemetry.record({ authMode: 'pair-code', outcome: 'duplicate' });
  now += 10;
  telemetry.record({ authMode: 'pairing-challenge', outcome: 'rejected' });

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.total, 3);
  assert.deepEqual(snapshot.byAuthMode, { bearer: 1, 'pair-code': 1, 'pairing-challenge': 1 });
  assert.deepEqual(snapshot.byOutcome, { accepted: 1, duplicate: 1, rejected: 1 });
  assert.equal(snapshot.lastObservedAt, new Date(now).toISOString());
  assert.equal(JSON.stringify(snapshot).includes('token'), false);
  assert.equal(JSON.stringify(snapshot).includes('credential'), false);
});

test('deprecation readiness fails closed without physical-device resumable acceptance', () => {
  let now = 1_000;
  const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 500 });
  now = 2_000;
  const readiness = telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: false });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, ['PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED']);
});

test('deprecation readiness fails closed while observation window is incomplete', () => {
  let now = 1_000;
  const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 5_000 });
  now = 4_000;
  const readiness = telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: true });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, ['OBSERVATION_WINDOW_INCOMPLETE']);
});

test('any observed compatibility traffic blocks retirement even after acceptance and observation window', () => {
  let now = 1_000;
  const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 500 });
  telemetry.record({ authMode: 'bearer', outcome: 'accepted' });
  now = 2_000;
  const readiness = telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: true });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.compatibilityRequests, 1);
  assert.deepEqual(readiness.blockers, ['COMPATIBILITY_TRAFFIC_OBSERVED']);
});

test('retirement becomes ready only after accepted physical testing, full window, and zero compatibility traffic', () => {
  let now = 1_000;
  const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 500 });
  now = 2_000;
  const readiness = telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: true });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.compatibilityRequests, 0);
  assert.deepEqual(readiness.blockers, []);
});
