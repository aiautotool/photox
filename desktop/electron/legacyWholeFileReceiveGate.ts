import type { IncomingMessage } from 'node:http';
import {
  resolveLegacyWholeFileReceiverPreflight,
  type LegacyWholeFileAuthMode,
  type LegacyWholeFileReceiverPreflight,
} from './legacyWholeFileReceiverPreflight.js';
import type { LegacyWholeFileAuthPrincipal } from './legacyMediaAuditAttribution.js';

export type LegacyWholeFileReceiveGateResult =
  | { state: 'ready'; preflight: LegacyWholeFileReceiverPreflight }
  | { state: 'duplicate'; preflight: LegacyWholeFileReceiverPreflight };

/**
 * Resolve the complete identity boundary for the legacy whole-file receiver and
 * check authoritative duplicate state before callers reserve quota or consume
 * the request body.
 *
 * The caller is intentionally responsible for authentication itself. This gate
 * only accepts the already-established auth mode/principal and turns them into
 * the immutable workspace/device/asset key used by the ingest transaction.
 */
export async function resolveLegacyWholeFileReceiveGate(input: {
  req: Pick<IncomingMessage, 'headers'>;
  defaultWorkspaceId: string;
  legacyOwnerUserId: string;
  authMode: LegacyWholeFileAuthMode;
  principal?: LegacyWholeFileAuthPrincipal;
  exists: (input: { workspaceId: string; key: string }) => Promise<boolean> | boolean;
}): Promise<LegacyWholeFileReceiveGateResult> {
  const preflight = resolveLegacyWholeFileReceiverPreflight({
    req: input.req,
    defaultWorkspaceId: input.defaultWorkspaceId,
    legacyOwnerUserId: input.legacyOwnerUserId,
    authMode: input.authMode,
    principal: input.principal,
  });

  const duplicate = await input.exists({ workspaceId: preflight.workspaceId, key: preflight.key });
  return duplicate ? { state: 'duplicate', preflight } : { state: 'ready', preflight };
}
