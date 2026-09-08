import type { IncomingMessage } from 'node:http';
import {
  resolveLegacyWholeFileReceiverPreflight,
  type LegacyWholeFileAuthMode,
  type LegacyWholeFileReceiverPreflight,
} from './legacyWholeFileReceiverPreflight.js';
import type { LegacyWholeFileAuthPrincipal } from './legacyMediaAuditAttribution.js';
import { recordLegacyWholeFileCompatibility } from './legacyWholeFileCompatibilityTelemetryProduction.js';

export type LegacyWholeFileReceiveGateResult =
  | { state: 'ready'; preflight: LegacyWholeFileReceiverPreflight }
  | { state: 'duplicate'; preflight: LegacyWholeFileReceiverPreflight };

/**
 * Resolve the complete identity boundary for the legacy whole-file receiver and
 * check authoritative duplicate state before callers reserve quota or consume
 * the request body.
 *
 * Compatibility telemetry is recorded at this boundary because reaching it
 * proves a whole-file client still depends on the legacy route. `accepted`
 * means the request passed the pre-ingest gate, not that catalog/file commit
 * completed; that distinction intentionally keeps telemetry observational and
 * unable to change ingest semantics.
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
  try {
    const preflight = resolveLegacyWholeFileReceiverPreflight({
      req: input.req,
      defaultWorkspaceId: input.defaultWorkspaceId,
      legacyOwnerUserId: input.legacyOwnerUserId,
      authMode: input.authMode,
      principal: input.principal,
    });

    const duplicate = await input.exists({ workspaceId: preflight.workspaceId, key: preflight.key });
    recordLegacyWholeFileCompatibility({
      authMode: input.authMode,
      outcome: duplicate ? 'duplicate' : 'accepted',
    });
    return duplicate ? { state: 'duplicate', preflight } : { state: 'ready', preflight };
  } catch (error) {
    recordLegacyWholeFileCompatibility({ authMode: input.authMode, outcome: 'rejected' });
    throw error;
  }
}
