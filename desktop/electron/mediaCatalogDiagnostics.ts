import type { MediaCatalogBackendHealth } from './mediaCatalogBackend.js';

export type MediaCatalogDiagnosticScope = 'workspace' | 'operator';

export type MediaCatalogWorkspaceDiagnostics = {
  kind: 'sqlite';
  schemaVersion: number;
  migrationStatus: MediaCatalogBackendHealth['migrationStatus'];
  rowCount: number;
  importedRowCount: number;
  backupAvailable: boolean;
};

export type MediaCatalogOperatorDiagnostics = MediaCatalogWorkspaceDiagnostics & {
  backupPath?: string;
  sourceSha256?: string;
};

/**
 * Produces an explicit diagnostics boundary for Desktop/Web operations surfaces.
 * Workspace-visible diagnostics intentionally omit host filesystem paths and the
 * legacy source fingerprint. Operator scope may expose those fields to a trusted
 * local/admin surface for offline recovery work.
 */
export function mediaCatalogDiagnostics(
  health: MediaCatalogBackendHealth,
  scope: 'workspace',
): MediaCatalogWorkspaceDiagnostics;
export function mediaCatalogDiagnostics(
  health: MediaCatalogBackendHealth,
  scope: 'operator',
): MediaCatalogOperatorDiagnostics;
export function mediaCatalogDiagnostics(
  health: MediaCatalogBackendHealth,
  scope: MediaCatalogDiagnosticScope,
): MediaCatalogWorkspaceDiagnostics | MediaCatalogOperatorDiagnostics {
  const base: MediaCatalogWorkspaceDiagnostics = {
    kind: health.kind,
    schemaVersion: health.schemaVersion,
    migrationStatus: health.migrationStatus,
    rowCount: health.rowCount,
    importedRowCount: health.importedRowCount,
    backupAvailable: Boolean(health.backupPath),
  };

  if (scope === 'workspace') return base;
  if (scope !== 'operator') throw new Error('MEDIA_CATALOG_DIAGNOSTIC_SCOPE_INVALID');

  return {
    ...base,
    backupPath: health.backupPath,
    sourceSha256: health.sourceSha256,
  };
}
