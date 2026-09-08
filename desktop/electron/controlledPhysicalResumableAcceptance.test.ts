import assert from 'node:assert/strict';
import test from 'node:test';
import { PhysicalResumableAcceptanceIngestion } from './physicalResumableAcceptanceIngestion.js';
import { controlledPhysicalAcceptanceFromEnvironment } from './resumableMediaProductionRuntime.js';

const RELEASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function runtimeOptions(overrides: Record<string, unknown> = {}) {
  const seen: Array<{ workspaceId: string; key: string }> = [];
  const options = {
    incomingRoot: '/tmp/photox-state/incoming',
    now: () => Date.parse('2026-09-08T07:00:00.000Z'),
    workspaces: {
      getUsage: (workspaceId: string) => {
        assert.equal(workspaceId, 'ws-a');
        return { managedStorageBytes: 1234 };
      },
    },
    exists: async (input: { workspaceId: string; key: string }) => {
      seen.push(input);
      return input.key === 'device-a:asset-a';
    },
    ...overrides,
  };
  return { options: options as any, seen };
}

function session() {
  return {
    version: 2 as const,
    sessionId: 'upload-a',
    workspaceId: 'ws-a',
    deviceId: 'device-a',
    actorUserId: 'user-a',
    assetId: 'asset-a',
    filename: 'photo.jpg',
    mimeType: 'image/jpeg',
    mediaType: 'photo' as const,
    createdAt: 1,
    expectedBytes: 10,
    acknowledgedBytes: 4,
    createdAtIso: '2026-09-08T06:59:00.000Z',
    updatedAtIso: '2026-09-08T07:00:00.000Z',
    expiresAtIso: '2026-09-09T07:00:00.000Z',
  };
}

test('controlled physical acceptance stays disabled without explicit real-device mode', () => {
  const { options } = runtimeOptions();
  assert.equal(controlledPhysicalAcceptanceFromEnvironment(options, {}), undefined);
});

test('controlled physical acceptance fails closed on unknown mode, missing authority, or invalid release SHA', () => {
  const { options } = runtimeOptions();
  assert.throws(
    () => controlledPhysicalAcceptanceFromEnvironment(options, { PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE: 'manual', PHOTOX_RELEASE_COMMIT_SHA: RELEASE_SHA }),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_MODE_INVALID/,
  );
  assert.throws(
    () => controlledPhysicalAcceptanceFromEnvironment(options, { PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE: 'real-device', PHOTOX_RELEASE_COMMIT_SHA: 'short' }),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_RELEASE_SHA_INVALID/,
  );
  const missingUsage = runtimeOptions({ workspaces: {} }).options;
  assert.throws(
    () => controlledPhysicalAcceptanceFromEnvironment(missingUsage, { PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE: 'real-device', PHOTOX_RELEASE_COMMIT_SHA: RELEASE_SHA }),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_USAGE_AUTHORITY_REQUIRED/,
  );
});

test('controlled physical acceptance derives quota and target catalog row from server authorities', async () => {
  const { options, seen } = runtimeOptions();
  const controlled = controlledPhysicalAcceptanceFromEnvironment(options, {
    PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE: 'real-device',
    PHOTOX_RELEASE_COMMIT_SHA: RELEASE_SHA.toUpperCase(),
  });
  assert.ok(controlled);
  assert.equal(controlled.releaseCommitSha, RELEASE_SHA);
  assert.equal(controlled.stateDirectory, '/tmp/photox-state');
  const counters = await controlled.counters('ws-a', session());
  assert.deepEqual(counters, { quotaBytes: 1234, catalogRows: 1, observedAt: '2026-09-08T07:00:00.000Z' });
  assert.deepEqual(seen, [{ workspaceId: 'ws-a', key: 'device-a:asset-a' }]);
});

test('acceptance ingestion rejects a mobile report for a different release before consulting server authority', async () => {
  let authorityCalled = false;
  const ingestion = new PhysicalResumableAcceptanceIngestion(
    { observe: async () => { authorityCalled = true; throw new Error('SHOULD_NOT_BE_CALLED'); } },
    {} as any,
    RELEASE_SHA,
  );
  const report = {
    version: 1,
    runId: 'run-release-mismatch',
    startedAt: '2026-09-08T07:00:00.000Z',
    release: { appVersion: '4.0.0', buildNumber: '400', commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    device: { platform: 'android', model: 'Pixel', osVersion: '16' },
    upload: { assetId: 'asset-a', sessionId: 'upload-a', assetSizeBytes: 10 },
    scenario: {
      networkInterruptedAt: '2026-09-08T07:01:00.000Z',
      interruptedAfterBytes: 4,
      processKilledAt: '2026-09-08T07:02:00.000Z',
      appRestartedAt: '2026-09-08T07:03:00.000Z',
      resumeStartedAt: '2026-09-08T07:04:00.000Z',
      resumedFromByte: 4,
      completedAt: '2026-09-08T07:05:00.000Z',
    },
  };
  await assert.rejects(
    () => ingestion.ingest({ workspaceId: 'ws-a', deviceId: 'device-a', report }),
    /PHYSICAL_RESUMABLE_ACCEPTANCE_RELEASE_MISMATCH/,
  );
  assert.equal(authorityCalled, false);
});
