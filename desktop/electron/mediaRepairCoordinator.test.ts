import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaRepairCoordinator, type RepairMediaRecord } from './mediaRepairCoordinator.js';

function media(overrides: Partial<RepairMediaRecord> = {}): RepairMediaRecord {
  return {
    workspaceId: 'workspace-a',
    key: 'device:asset-1',
    localAvailable: true,
    verifiedAccountIds: [],
    targetReplicas: 2,
    ...overrides,
  };
}

test('repairs only the requested workspace/media key', async () => {
  const scheduled: string[] = [];
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async (workspaceId, key) => workspaceId === 'workspace-a' && key === 'device:asset-1' ? media() : undefined,
    scheduleUpload: async item => { scheduled.push(`${item.workspaceId}:${item.key}`); },
  });

  const result = await coordinator.repair('workspace-a', 'device:asset-1');
  assert.equal(result.status, 'queued');
  assert.deepEqual(scheduled, ['workspace-a:device:asset-1']);
  await assert.rejects(() => coordinator.repair('workspace-b', 'device:asset-1'), /MEDIA_REPAIR_NOT_FOUND/);
  assert.deepEqual(scheduled, ['workspace-a:device:asset-1']);
});

test('does not enqueue media that already meets the unique-account target', async () => {
  let calls = 0;
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async () => media({ verifiedAccountIds: ['drive-a', 'drive-a', 'drive-b'] }),
    scheduleUpload: async () => { calls += 1; },
  });

  const result = await coordinator.repair('workspace-a', 'device:asset-1');
  assert.equal(result.status, 'already_safe');
  assert.equal(result.verifiedReplicas, 2);
  assert.equal(calls, 0);
});

test('fails closed when the local original cannot seed a replacement', async () => {
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async () => media({ localAvailable: false, verifiedAccountIds: ['drive-a'] }),
    scheduleUpload: async () => assert.fail('scheduleUpload must not run without a local original'),
  });

  await assert.rejects(() => coordinator.repair('workspace-a', 'device:asset-1'), /MEDIA_REPAIR_LOCAL_ORIGINAL_UNAVAILABLE/);
});

test('deduplicates concurrent repair clicks for the same workspace/key', async () => {
  let releases!: () => void;
  const gate = new Promise<void>(resolve => { releases = resolve; });
  let calls = 0;
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async () => media({ verifiedAccountIds: ['drive-a'] }),
    scheduleUpload: async () => { calls += 1; await gate; },
  });

  const first = coordinator.repair('workspace-a', 'device:asset-1');
  const second = coordinator.repair('workspace-a', 'device:asset-1');
  assert.strictEqual(first, second);
  releases();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 'queued');
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});

test('allows different media keys to schedule independently', async () => {
  const scheduled: string[] = [];
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async (workspaceId, key) => media({ workspaceId, key }),
    scheduleUpload: async item => { scheduled.push(item.key); },
  });

  await Promise.all([
    coordinator.repair('workspace-a', 'device:asset-1'),
    coordinator.repair('workspace-a', 'device:asset-2'),
  ]);
  assert.deepEqual(scheduled.sort(), ['device:asset-1', 'device:asset-2']);
});

test('validates required workspace and key before loading media', async () => {
  let loads = 0;
  const coordinator = new MediaRepairCoordinator({
    loadMedia: async () => { loads += 1; return media(); },
    scheduleUpload: async () => undefined,
  });

  await assert.rejects(() => coordinator.repair('   ', 'device:asset-1'), /MEDIA_REPAIR_WORKSPACE_REQUIRED/);
  await assert.rejects(() => coordinator.repair('workspace-a', '   '), /MEDIA_REPAIR_KEY_REQUIRED/);
  assert.equal(loads, 0);
});
