import type { IncomingMessage } from 'node:http';
import {
  legacyWholeFileAuditAttribution,
  type LegacyWholeFileAuditAttribution,
  type LegacyWholeFileAuthPrincipal,
} from './legacyMediaAuditAttribution.js';

export type LegacyWholeFileAuthMode = 'bearer' | 'pair-code' | 'pairing-challenge';

export type LegacyWholeFileReceiverPreflight = {
  workspaceId: string;
  deviceId: string;
  assetId: string;
  key: string;
  audit: LegacyWholeFileAuditAttribution;
};

export function resolveLegacyWholeFileReceiverPreflight(input: {
  req: Pick<IncomingMessage, 'headers'>;
  defaultWorkspaceId: string;
  legacyOwnerUserId: string;
  authMode: LegacyWholeFileAuthMode;
  principal?: LegacyWholeFileAuthPrincipal;
}): LegacyWholeFileReceiverPreflight {
  const requestWorkspaceId = String(input.req.headers['x-photosync-workspace-id'] || input.principal?.workspaceId || input.defaultWorkspaceId);
  const requestDeviceId = String(input.req.headers['x-photosync-device-id'] || input.principal?.deviceId || 'unknown');
  const assetId = String(input.req.headers['x-photosync-asset-id'] || '');

  if (!requestWorkspaceId) throw new Error('WHOLE_FILE_WORKSPACE_REQUIRED');
  if (!requestDeviceId || requestDeviceId === 'unknown') throw new Error('WHOLE_FILE_DEVICE_REQUIRED');
  if (!assetId) throw new Error('WHOLE_FILE_ASSET_REQUIRED');

  const audit = legacyWholeFileAuditAttribution({
    principal: input.principal,
    requestWorkspaceId,
    requestDeviceId,
    legacyOwnerUserId: input.legacyOwnerUserId,
    authMode: input.authMode,
  });

  return {
    workspaceId: requestWorkspaceId,
    deviceId: requestDeviceId,
    assetId,
    key: `${requestDeviceId}:${assetId}`,
    audit,
  };
}
