import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyWholeFileAuditAttribution } from './legacyMediaAuditAttribution.js';

const base = {
  requestWorkspaceId: 'workspace-a',
  requestDeviceId: 'device-a',
  legacyOwnerUserId: 'legacy-owner',
} as const;

test('bearer whole-file audit uses authoritative authenticated member attribution', () => {
  assert.deepEqual(
    legacyWholeFileAuditAttribution({
      ...base,
      authMode: 'bearer',
      principal: {
        subject: 'member-a',
        workspaceId: 'workspace-a',
        deviceId: 'device-a',
        sessionId: 'session-a',
        workspaceRole: 'member',
      },
    }),
    {
      actorUserId: 'member-a',
      actorDeviceId: 'device-a',
      metadata: {
        transport: 'whole-file',
        attribution: 'authenticated-member',
        authMode: 'bearer',
        sessionId: 'session-a',
        role: 'member',
      },
    },
  );
});

test('bearer whole-file audit fails closed when workspace binding is lost', () => {
  assert.throws(
    () => legacyWholeFileAuditAttribution({
      ...base,
      authMode: 'bearer',
      principal: { subject: 'member-a', workspaceId: 'workspace-b', deviceId: 'device-a' },
    }),
    /WHOLE_FILE_AUDIT_WORKSPACE_BINDING_REQUIRED/,
  );
});

test('bearer whole-file audit fails closed when device binding is lost', () => {
  assert.throws(
    () => legacyWholeFileAuditAttribution({
      ...base,
      authMode: 'bearer',
      principal: { subject: 'member-a', workspaceId: 'workspace-a', deviceId: 'device-b' },
    }),
    /WHOLE_FILE_AUDIT_DEVICE_BINDING_REQUIRED/,
  );
});

test('pair-code whole-file audit is explicitly marked legacy compatibility attribution', () => {
  const result = legacyWholeFileAuditAttribution({ ...base, authMode: 'pair-code' });
  assert.equal(result.actorUserId, 'legacy-owner');
  assert.equal(result.actorDeviceId, 'device-a');
  assert.deepEqual(result.metadata, {
    transport: 'whole-file',
    attribution: 'legacy-compatibility',
    authMode: 'pair-code',
  });
});

test('pairing-challenge whole-file audit is explicitly marked legacy compatibility attribution', () => {
  const result = legacyWholeFileAuditAttribution({ ...base, authMode: 'pairing-challenge' });
  assert.equal(result.metadata.attribution, 'legacy-compatibility');
  assert.equal(result.metadata.authMode, 'pairing-challenge');
});
