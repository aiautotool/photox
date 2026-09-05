import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDriveReplicaProbe, probeDriveReplica, replicaNeedsRemoteVerification, verifiedReplicaAccountCount } from './driveReplicaHealth.js';

const NOW = new Date('2026-09-05T05:00:00.000Z');

test('healthy Drive replica refreshes authoritative verification and captures checksum', async () => {
  const result = await probeDriveReplica({
    remoteFileId: 'file-1', expectedSizeBytes: 123, now: () => NOW,
    fetchRemote: async () => ({ id: 'file-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: '123', md5Checksum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
  });
  assert.equal(result.kind, 'healthy');
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1', verifiedAt: '2026-09-01T00:00:00.000Z' }, result);
  assert.equal(updated.state, 'VERIFIED');
  assert.equal(updated.verifiedAt, NOW.toISOString());
  assert.equal(updated.remoteMd5, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('definitively missing Drive object is downgraded and becomes repairable', async () => {
  const result = await probeDriveReplica({
    remoteFileId: 'gone', expectedSizeBytes: 10, now: () => NOW,
    fetchRemote: async () => { throw new Error('Google Drive 404: File not found'); },
  });
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'gone' }, result);
  assert.equal(updated.state, 'ERROR');
  assert.equal(updated.message, 'DRIVE_REPLICA_MISSING');
  assert.equal(verifiedReplicaAccountCount([updated, { state: 'VERIFIED', accountId: 'drive-b', remoteFileId: 'ok' }]), 1);
});

test('size mismatch is downgraded before it can count as healthy', async () => {
  const result = await probeDriveReplica({
    remoteFileId: 'file-1', expectedSizeBytes: 123, now: () => NOW,
    fetchRemote: async () => ({ id: 'file-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: '122' }),
  });
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1' }, result);
  assert.equal(updated.state, 'ERROR');
  assert.equal(updated.message, 'DRIVE_REPLICA_SIZE_MISMATCH');
});

test('persisted Drive checksum mismatch is downgraded', async () => {
  const result = await probeDriveReplica({
    remoteFileId: 'file-1', expectedSizeBytes: 123, storedMd5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', now: () => NOW,
    fetchRemote: async () => ({ id: 'file-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: '123', md5Checksum: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
  });
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1', remoteMd5: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, result);
  assert.equal(updated.state, 'ERROR');
  assert.equal(updated.message, 'DRIVE_REPLICA_CHECKSUM_MISMATCH');
});

test('Drive source SHA-256 app property mismatch is downgraded', async () => {
  const expectedSha256 = 'a'.repeat(64);
  const result = await probeDriveReplica({
    remoteFileId: 'file-1', expectedSizeBytes: 123, expectedSha256, now: () => NOW,
    fetchRemote: async () => ({
      id: 'file-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: '123',
      appProperties: { photosyncSha256: 'b'.repeat(64) },
    }),
  });
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1' }, result);
  assert.equal(updated.state, 'ERROR');
  assert.equal(updated.message, 'DRIVE_REPLICA_SOURCE_HASH_MISMATCH');
});

test('transient provider failure preserves the last verified replica and schedules a later probe', async () => {
  const result = await probeDriveReplica({
    remoteFileId: 'file-1', expectedSizeBytes: 123, now: () => NOW,
    fetchRemote: async () => { throw new Error('Google Drive 503: backend unavailable secret-details'); },
  });
  const updated = applyDriveReplicaProbe({ state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1', verifiedAt: '2026-09-01T00:00:00.000Z' }, result);
  assert.equal(updated.state, 'VERIFIED');
  assert.equal(updated.verifiedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(updated.message, 'DRIVE_REPLICA_VERIFICATION_DEFERRED');
  assert.ok(!JSON.stringify(updated).includes('secret-details'));
  assert.equal(replicaNeedsRemoteVerification(updated, NOW.getTime() + 15 * 60_000, 15 * 60_000), true);
});

test('fresh verified replicas do not hammer the provider before the configured interval', () => {
  const fresh = { state: 'VERIFIED' as const, accountId: 'drive-a', remoteFileId: 'file-1', remoteCheckedAt: NOW.toISOString() };
  assert.equal(replicaNeedsRemoteVerification(fresh, NOW.getTime() + 14 * 60_000, 15 * 60_000), false);
  assert.equal(replicaNeedsRemoteVerification(fresh, NOW.getTime() + 15 * 60_000, 15 * 60_000), true);
  assert.equal(replicaNeedsRemoteVerification({ ...fresh, accountId: undefined }, NOW.getTime() + 16 * 60_000, 15 * 60_000), false);
});
