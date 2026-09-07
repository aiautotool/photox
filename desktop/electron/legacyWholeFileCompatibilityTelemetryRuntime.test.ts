import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacyWholeFileCompatibilityTelemetry } from './legacyWholeFileCompatibilityTelemetry.js';
import { LegacyWholeFileCompatibilityTelemetryRuntime } from './legacyWholeFileCompatibilityTelemetryRuntime.js';

type MemoryStoreState = ReturnType<LegacyWholeFileCompatibilityTelemetry['exportPersistedState']> | undefined;

function memoryStore(input: { failLoad?: boolean; failSave?: boolean } = {}) {
  let state: MemoryStoreState;
  return {
    get state() { return state; },
    async load(options: { now?: () => number; minimumObservationMs?: number }) {
      if (input.failLoad) throw new Error('simulated load failure');
      return new LegacyWholeFileCompatibilityTelemetry({ ...options, persistedState: state });
    },
    async save(telemetry: LegacyWholeFileCompatibilityTelemetry) {
      if (input.failSave) throw new Error('simulated save failure');
      state = telemetry.exportPersistedState();
    },
  };
}

test('runtime serializes compatibility record into durable state without failing caller', async () => {
  let now = 1_000;
  const store = memoryStore();
  const runtime = await LegacyWholeFileCompatibilityTelemetryRuntime.create(store, {
    now: () => now,
    minimumObservationMs: 100,
  });

  runtime.record({ authMode: 'bearer', outcome: 'accepted' });
  now = 1_050;
  runtime.record({ authMode: 'pair-code', outcome: 'duplicate' });
  await runtime.flush();

  assert.equal(store.state?.total, 2);
  assert.equal(store.state?.byAuthMode.bearer, 1);
  assert.equal(store.state?.byAuthMode['pair-code'], 1);
  assert.equal(store.state?.byOutcome.accepted, 1);
  assert.equal(store.state?.byOutcome.duplicate, 1);
  assert.equal(runtime.diagnostics({ at: 1_200 }).persistence.healthy, true);
});

test('save failure is non-fatal but fail-closes deprecation readiness', async () => {
  let now = 5_000;
  const errors: unknown[] = [];
  const runtime = await LegacyWholeFileCompatibilityTelemetryRuntime.create(memoryStore({ failSave: true }), {
    now: () => now,
    minimumObservationMs: 0,
    onPersistenceError: error => errors.push(error),
  });

  assert.doesNotThrow(() => runtime.record({ authMode: 'pairing-challenge', outcome: 'rejected' }));
  await runtime.flush();
  now = 6_000;
  const diagnostics = runtime.diagnostics({ physicalDeviceResumableAccepted: true });

  assert.equal(errors.length, 1);
  assert.equal(diagnostics.persistence.healthy, false);
  assert.equal(diagnostics.deprecationReadiness.ready, false);
  assert.ok(diagnostics.deprecationReadiness.blockers.includes('TELEMETRY_PERSISTENCE_UNHEALTHY'));
  assert.ok(diagnostics.deprecationReadiness.blockers.includes('COMPATIBILITY_TRAFFIC_OBSERVED'));
});

test('load failure starts fresh observation state and blocks deprecation until persistence recovers', async () => {
  let now = 10_000;
  const errors: unknown[] = [];
  const store = memoryStore({ failLoad: true });
  const runtime = await LegacyWholeFileCompatibilityTelemetryRuntime.create(store, {
    now: () => now,
    minimumObservationMs: 0,
    onPersistenceError: error => errors.push(error),
  });

  const diagnostics = runtime.diagnostics({ physicalDeviceResumableAccepted: true, at: 20_000 });
  assert.equal(errors.length, 1);
  assert.equal(diagnostics.snapshot.total, 0);
  assert.equal(diagnostics.persistence.healthy, false);
  assert.deepEqual(diagnostics.deprecationReadiness.blockers, ['TELEMETRY_PERSISTENCE_UNHEALTHY']);
});

test('operator diagnostics default physical-device acceptance to false and remain credential free', async () => {
  const store = memoryStore();
  const runtime = await LegacyWholeFileCompatibilityTelemetryRuntime.create(store, { now: () => 30_000, minimumObservationMs: 0 });
  runtime.record({ authMode: 'pair-code', outcome: 'accepted' });
  await runtime.flush();

  const diagnostics = runtime.diagnostics({ at: 31_000 });
  assert.equal(diagnostics.deprecationReadiness.physicalDeviceResumableAccepted, false);
  assert.ok(diagnostics.deprecationReadiness.blockers.includes('PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED'));
  const serialized = JSON.stringify(diagnostics);
  for (const forbidden of ['token', 'credential', 'workspaceId', 'deviceId', 'filename', 'mediaKey', 'authorization']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
