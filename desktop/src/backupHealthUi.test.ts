import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBackupProblemViews, backupReplicaStatusLabel } from './backupHealthUi.js';
import type { BackupHealthSnapshot, CloudUpload, LocalMedia } from './bridge.js';

const health: BackupHealthSnapshot = {
  total: 1,
  safe: 0,
  atRisk: 0,
  critical: 1,
  unknown: 0,
  photos: 1,
  videos: 0,
  totalBytes: 100,
  problems: [{ key: 'device:asset', filename: 'IMG_1.JPG', health: 'critical', reason: 'original_replica_count' }],
};

function media(localAvailable: boolean): LocalMedia[] {
  return [{
    key: 'device:asset', name: 'IMG_1.JPG', path: '/library/IMG_1.JPG', url: 'photosync://media/device%3Aasset',
    modifiedAt: new Date(0).toISOString(), size: 100, receivedAt: new Date(0).toISOString(), sha256: 'abc',
    localAvailable, cloudAvailable: true,
  }];
}

function upload(state: CloudUpload['state'], accountId: string, message?: string): CloudUpload {
  return {
    key: 'device:asset', filename: 'IMG_1.JPG', size: 100, receivedAt: new Date(0).toISOString(), deviceId: 'device',
    state, accountId, accountEmail: `${accountId}@example.test`, message,
  };
}

test('problem drill-down counts unique verified accounts and exposes failed/pending replicas', () => {
  const [problem] = buildBackupProblemViews(health, [
    upload('VERIFIED', 'drive-a'),
    upload('VERIFIED', 'drive-a'),
    upload('ERROR', 'drive-b', 'DRIVE_REPLICA_MISSING'),
    upload('QUEUED', 'drive-c'),
  ], media(true));
  assert.equal(problem.verifiedReplicas, 1);
  assert.equal(problem.failedReplicas, 1);
  assert.equal(problem.pendingReplicas, 1);
  assert.equal(problem.canRepair, true);
  assert.equal(problem.replicas[2]?.message, 'DRIVE_REPLICA_MISSING');
});

test('repair action is disabled when the local original is unavailable', () => {
  const [problem] = buildBackupProblemViews(health, [upload('ERROR', 'drive-a')], media(false));
  assert.equal(problem.localAvailable, false);
  assert.equal(problem.canRepair, false);
});

test('repair action is disabled once target replica count is already satisfied', () => {
  const [problem] = buildBackupProblemViews(health, [upload('VERIFIED', 'drive-a'), upload('UPLOADED', 'drive-b')], media(true));
  assert.equal(problem.verifiedReplicas, 2);
  assert.equal(problem.canRepair, false);
});

test('renderer labels replica states without exposing fake success', () => {
  assert.equal(backupReplicaStatusLabel('VERIFIED'), 'Đã xác minh');
  assert.equal(backupReplicaStatusLabel('ERROR'), 'Lỗi');
  assert.equal(backupReplicaStatusLabel('VERIFYING'), 'Đang xử lý');
  assert.equal(backupReplicaStatusLabel('QUEUED'), 'Đang chờ');
});
