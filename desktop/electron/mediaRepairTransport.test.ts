import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaRepairCoordinator, type RepairMediaRecord } from './mediaRepairCoordinator.js';
import { assertMediaRepairRole, repairMediaFromPrincipal, type MediaRepairAuditEvent } from './mediaRepairTransport.js';

function coordinatorFor(records: RepairMediaRecord[], scheduled: string[]) {
  return new MediaRepairCoordinator({
    async loadMedia(workspaceId, key) {
      return records.find(item => item.workspaceId === workspaceId && item.key === key);
    },
    async scheduleUpload(media) {
      scheduled.push(`${media.workspaceId}:${media.key}`);
    },
  });
}

const base: RepairMediaRecord = {
  workspaceId: 'workspace-a',
  key: 'asset-1',
  localAvailable: true,
  verifiedAccountIds: ['drive-a'],
  targetReplicas: 2,
};

test('member, admin and owner may request repair while viewer is rejected', () => {
  assert.doesNotThrow(() => assertMediaRepairRole('member'));
  assert.doesNotThrow(() => assertMediaRepairRole('admin'));
  assert.doesNotThrow(() => assertMediaRepairRole('owner'));
  assert.throws(() => assertMediaRepairRole('viewer'), /MEDIA_REPAIR_FORBIDDEN/);
  assert.throws(() => assertMediaRepairRole(undefined), /MEDIA_REPAIR_FORBIDDEN/);
});

test('workspace authority comes only from the authenticated principal', async () => {
  const scheduled: string[] = [];
  const coordinator = coordinatorFor([
    base,
    { ...base, workspaceId: 'workspace-b', key: 'asset-1', verifiedAccountIds: [] },
  ], scheduled);

  await repairMediaFromPrincipal({
    principal: { subject: 'member-a', workspaceId: 'workspace-a', workspaceRole: 'member' },
    key: 'asset-1',
    coordinator,
    source: 'web',
  });

  assert.deepEqual(scheduled, ['workspace-a:asset-1']);
});

test('viewer denial occurs before coordinator lookup or upload scheduling', async () => {
  let loaded = false;
  const coordinator = new MediaRepairCoordinator({
    async loadMedia() { loaded = true; return base; },
    async scheduleUpload() { throw new Error('must not schedule'); },
  });

  await assert.rejects(repairMediaFromPrincipal({
    principal: { subject: 'viewer', workspaceId: 'workspace-a', workspaceRole: 'viewer' },
    key: 'asset-1',
    coordinator,
    source: 'web',
  }), /MEDIA_REPAIR_FORBIDDEN/);
  assert.equal(loaded, false);
});

test('successful repair emits an audit event with exact media identity and result', async () => {
  const scheduled: string[] = [];
  const audit: MediaRepairAuditEvent[] = [];
  const coordinator = coordinatorFor([base], scheduled);

  const result = await repairMediaFromPrincipal({
    principal: { subject: 'member-a', workspaceId: 'workspace-a', workspaceRole: 'member', sessionId: 'session-1' },
    key: '  asset-1  ',
    coordinator,
    source: 'web',
    appendAudit: async (_principal, event) => { audit.push(event); },
  });

  assert.equal(result.status, 'queued');
  assert.deepEqual(scheduled, ['workspace-a:asset-1']);
  assert.deepEqual(audit, [{
    action: 'media.repair',
    targetType: 'media',
    targetId: 'asset-1',
    metadata: { status: 'queued', verifiedReplicas: 1, targetReplicas: 2, source: 'web' },
  }]);
});

test('already-safe media is audited but does not schedule another upload', async () => {
  const scheduled: string[] = [];
  const audit: MediaRepairAuditEvent[] = [];
  const coordinator = coordinatorFor([{ ...base, verifiedAccountIds: ['drive-a', 'drive-b'] }], scheduled);

  const result = await repairMediaFromPrincipal({
    principal: { subject: 'owner', workspaceId: 'workspace-a', workspaceRole: 'owner' },
    key: 'asset-1',
    coordinator,
    source: 'desktop',
    appendAudit: (_principal, event) => { audit.push(event); },
  });

  assert.equal(result.status, 'already_safe');
  assert.deepEqual(scheduled, []);
  assert.equal(audit[0]?.metadata.status, 'already_safe');
});

test('empty media keys fail closed before coordinator execution', async () => {
  let loaded = false;
  const coordinator = new MediaRepairCoordinator({
    async loadMedia() { loaded = true; return base; },
    async scheduleUpload() {},
  });

  await assert.rejects(repairMediaFromPrincipal({
    principal: { subject: 'member', workspaceId: 'workspace-a', workspaceRole: 'member' },
    key: '   ',
    coordinator,
    source: 'web',
  }), /MEDIA_REPAIR_KEY_REQUIRED/);
  assert.equal(loaded, false);
});
