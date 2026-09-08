export type LegacyWholeFileAuthPrincipal = {
  subject: string;
  workspaceId?: string;
  deviceId?: string;
  sessionId?: string;
  workspaceRole?: string;
};

export type LegacyWholeFileAuditAttribution = {
  actorUserId: string;
  actorDeviceId: string;
  metadata: {
    transport: 'whole-file';
    attribution: 'authenticated-member' | 'legacy-compatibility';
    authMode: 'bearer' | 'pair-code' | 'pairing-challenge';
    sessionId?: string;
    role?: string;
  };
};

export function legacyWholeFileAuditAttribution(input: {
  principal?: LegacyWholeFileAuthPrincipal;
  requestWorkspaceId: string;
  requestDeviceId: string;
  legacyOwnerUserId: string;
  authMode: 'bearer' | 'pair-code' | 'pairing-challenge';
}): LegacyWholeFileAuditAttribution {
  const { principal, requestWorkspaceId, requestDeviceId, legacyOwnerUserId, authMode } = input;

  if (authMode === 'bearer') {
    if (!principal?.workspaceId || principal.workspaceId !== requestWorkspaceId) {
      throw new Error('WHOLE_FILE_AUDIT_WORKSPACE_BINDING_REQUIRED');
    }
    if (!principal.deviceId || principal.deviceId !== requestDeviceId) {
      throw new Error('WHOLE_FILE_AUDIT_DEVICE_BINDING_REQUIRED');
    }
    if (!principal.subject) throw new Error('WHOLE_FILE_AUDIT_ACTOR_REQUIRED');

    return {
      actorUserId: principal.subject,
      actorDeviceId: principal.deviceId,
      metadata: {
        transport: 'whole-file',
        attribution: 'authenticated-member',
        authMode: 'bearer',
        sessionId: principal.sessionId,
        role: principal.workspaceRole,
      },
    };
  }

  return {
    actorUserId: legacyOwnerUserId,
    actorDeviceId: requestDeviceId,
    metadata: {
      transport: 'whole-file',
      attribution: 'legacy-compatibility',
      authMode,
    },
  };
}
