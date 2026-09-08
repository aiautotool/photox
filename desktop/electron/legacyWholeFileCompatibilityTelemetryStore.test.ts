import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LegacyWholeFileCompatibilityTelemetry } from './legacyWholeFileCompatibilityTelemetry.js';
import { LegacyWholeFileCompatibilityTelemetryStore } from './legacyWholeFileCompatibilityTelemetryStore.js';

async function withTemporaryStore(
  run: (store: LegacyWholeFileCompatibilityTelemetryStore, filePath: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'photox-whole-file-telemetry-'));
  const filePath = join(directory, 'legacy-whole-file-compatibility.json');
  try {
    await run(new LegacyWholeFileCompatibilityTelemetryStore(filePath), filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('atomic telemetry store preserves compatibility evidence across Desktop restart', async () => {
  await withTemporaryStore(async (store, filePath) => {
    let now = 1_000;
    const beforeRestart = new LegacyWholeFileCompatibilityTelemetry({ now: () => now, minimumObservationMs: 500 });
    beforeRestart.record({ authMode: 'pair-code', outcome: 'duplicate', at: 1_100 });
    await store.save(beforeRestart);

    const persistedText = await readFile(filePath, 'utf8');
    assert.equal(persistedText.includes('token'), false);
    assert.equal(persistedText.includes('credential'), false);
    assert.equal(persistedText.includes('workspace'), false);
    assert.equal(persistedText.includes('deviceId'), false);

    now = 2_000;
    const afterRestart = await store.load({ now: () => now, minimumObservationMs: 500 });
    assert.equal(afterRestart.snapshot().observedSince, new Date(1_000).toISOString());
    assert.equal(afterRestart.snapshot().total, 1);
    assert.deepEqual(afterRestart.deprecationReadiness({ physicalDeviceResumableAccepted: true }).blockers, [
      'COMPATIBILITY_TRAFFIC_OBSERVED',
    ]);
  });
});

test('missing telemetry file begins a fresh fail-closed observation window', async () => {
  await withTemporaryStore(async (store) => {
    let now = 5_000;
    const telemetry = await store.load({ now: () => now, minimumObservationMs: 1_000 });
    now = 5_500;
    assert.equal(telemetry.snapshot().observedSince, new Date(5_000).toISOString());
    assert.deepEqual(telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: true }).blockers, [
      'OBSERVATION_WINDOW_INCOMPLETE',
    ]);
  });
});

test('corrupt telemetry file begins a fresh fail-closed observation window', async () => {
  await withTemporaryStore(async (store, filePath) => {
    await writeFile(filePath, '{not-json', 'utf8');
    let now = 9_000;
    const telemetry = await store.load({ now: () => now, minimumObservationMs: 1_000 });
    now = 9_250;
    assert.equal(telemetry.snapshot().observedSince, new Date(9_000).toISOString());
    assert.equal(telemetry.snapshot().total, 0);
    assert.deepEqual(telemetry.deprecationReadiness({ physicalDeviceResumableAccepted: true }).blockers, [
      'OBSERVATION_WINDOW_INCOMPLETE',
    ]);
  });
});
