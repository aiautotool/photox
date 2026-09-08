import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReplicaHealthPatches } from './mediaIndexReplicaMerge.js';

test('replica health patch preserves concurrent row metadata and new replicas', () => {
  const latest = [{
    workspaceId: 'ws-1',
    key: 'media-1',
    filename: 'new-name.mov',
    videoProcessing: 'ready',
    cloudReplicas: [
      { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a', message: 'old' },
      { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'file-b' },
      { state: 'QUEUED', accountId: 'drive-c' },
    ],
    cloud: { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a', message: 'old' },
  }];

  const result = applyReplicaHealthPatches(latest, [{
    workspaceId: 'ws-1',
    key: 'media-1',
    accountId: 'drive-a',
    remoteFileId: 'file-a',
    replica: {
      state: 'ERROR',
      accountId: 'drive-a',
      remoteFileId: 'file-a',
      remoteCheckedAt: '2026-09-05T07:00:00.000Z',
      message: 'DRIVE_REPLICA_REMOTE_MISSING',
    },
  }]);

  assert.equal(result.applied, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.rows[0].filename, 'new-name.mov');
  assert.equal(result.rows[0].videoProcessing, 'ready');
  assert.equal(result.rows[0].cloudReplicas?.length, 3);
  assert.equal(result.rows[0].cloudReplicas?.[0].state, 'ERROR');
  assert.equal(result.rows[0].cloudReplicas?.[1].state, 'VERIFIED');
  assert.equal(result.rows[0].cloudReplicas?.[2].state, 'QUEUED');
  assert.equal(result.rows[0].cloud?.state, 'ERROR');
});

test('replica health patch never resurrects a replica removed concurrently', () => {
  const latest = [{
    workspaceId: 'ws-1',
    key: 'media-1',
    cloudReplicas: [{ state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'file-b' }],
    cloud: { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'file-b' },
  }];

  const result = applyReplicaHealthPatches(latest, [{
    workspaceId: 'ws-1',
    key: 'media-1',
    accountId: 'drive-a',
    remoteFileId: 'file-a',
    replica: { state: 'ERROR', accountId: 'drive-a', remoteFileId: 'file-a' },
  }]);

  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.rows, latest);
});

test('replica health patch is skipped when media has an active deletion tombstone', () => {
  const latest = [{
    workspaceId: 'ws-1',
    key: 'media-1',
    deletion: { state: 'deleting' as const, claimId: 'delete-1', startedAt: '2026-09-06T00:00:00.000Z' },
    cloudReplicas: [{ state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a' }],
    cloud: { state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a' },
  }];

  const result = applyReplicaHealthPatches(latest, [{
    workspaceId: 'ws-1',
    key: 'media-1',
    accountId: 'drive-a',
    remoteFileId: 'file-a',
    replica: { state: 'ERROR', accountId: 'drive-a', remoteFileId: 'file-a', message: 'late verifier result' },
  }]);

  assert.equal(result.applied, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.rows, latest);
});

test('workspace identity prevents a verifier patch from crossing tenants', () => {
  const latest = [
    { workspaceId: 'ws-a', key: 'same-key', cloudReplicas: [{ state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a' }] },
    { workspaceId: 'ws-b', key: 'same-key', cloudReplicas: [{ state: 'VERIFIED', accountId: 'drive-a', remoteFileId: 'file-a' }] },
  ];

  const result = applyReplicaHealthPatches(latest, [{
    workspaceId: 'ws-b',
    key: 'same-key',
    accountId: 'drive-a',
    remoteFileId: 'file-a',
    replica: { state: 'ERROR', accountId: 'drive-a', remoteFileId: 'file-a' },
  }]);

  assert.equal(result.rows[0].cloudReplicas?.[0].state, 'VERIFIED');
  assert.equal(result.rows[1].cloudReplicas?.[0].state, 'ERROR');
});
