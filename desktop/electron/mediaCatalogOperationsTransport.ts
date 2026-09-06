import type { ActiveMediaCatalogBackend } from './mediaCatalogBackend.js';
import { mediaCatalogDiagnostics, type MediaCatalogOperatorDiagnostics, type MediaCatalogWorkspaceDiagnostics } from './mediaCatalogDiagnostics.js';
import type { RuntimeMediaIndexRow } from './mediaIndexRuntimeWriter.js';

export type MediaCatalogOperationsRole = 'owner' | 'admin' | 'member' | 'viewer';

export type MediaCatalogOperationsPrincipal = {
  workspaceId: string;
  workspaceRole?: MediaCatalogOperationsRole;
};

const ROLE_RANK: Record<MediaCatalogOperationsRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

function requireAdmin(principal: MediaCatalogOperationsPrincipal): void {
  const role = principal.workspaceRole ?? 'viewer';
  if (ROLE_RANK[role] < ROLE_RANK.admin) throw new Error('ROLE_FORBIDDEN');
  if (!principal.workspaceId.trim()) throw new Error('WORKSPACE_REQUIRED');
}

/**
 * Web operations boundary. Even owner/admin Web sessions only receive the
 * workspace-safe diagnostic shape: host filesystem paths and legacy source
 * fingerprints are intentionally local-operator-only recovery metadata.
 */
export function mediaCatalogDiagnosticsForWeb<T extends RuntimeMediaIndexRow>(
  backend: ActiveMediaCatalogBackend<T>,
  principal: MediaCatalogOperationsPrincipal,
): MediaCatalogWorkspaceDiagnostics {
  requireAdmin(principal);
  return mediaCatalogDiagnostics(backend.health, 'workspace');
}

/**
 * Trusted Desktop/operator boundary used by local recovery tooling. This is the
 * only transport allowed to expose backupPath/sourceSha256.
 */
export function mediaCatalogDiagnosticsForDesktopOperator<T extends RuntimeMediaIndexRow>(
  backend: ActiveMediaCatalogBackend<T>,
): MediaCatalogOperatorDiagnostics {
  return mediaCatalogDiagnostics(backend.health, 'operator');
}
