import type { MediaCatalogDiagnostics } from './bridge.js';

export type MediaCatalogOperationsView = {
  status: 'healthy' | 'attention';
  backend: 'SQLite';
  schemaVersion: number;
  migrationStatus: string;
  rowCount: number;
  importedRowCount: number;
  backupAvailable: boolean;
  recovery?: { backupPath: string; sourceSha256: string };
};

export function buildMediaCatalogOperationsView(
  diagnostics: MediaCatalogDiagnostics,
  platform: string,
): MediaCatalogOperationsView {
  const base: MediaCatalogOperationsView = {
    status: diagnostics.kind === 'sqlite' && diagnostics.schemaVersion > 0 ? 'healthy' : 'attention',
    backend: 'SQLite',
    schemaVersion: diagnostics.schemaVersion,
    migrationStatus: diagnostics.migrationStatus,
    rowCount: Math.max(0, diagnostics.rowCount),
    importedRowCount: Math.max(0, diagnostics.importedRowCount),
    backupAvailable: diagnostics.backupAvailable,
  };

  // Defense in depth: Web must never render host filesystem recovery metadata,
  // even if a future transport regression accidentally includes it.
  if (platform === 'web') return base;

  if (diagnostics.backupPath && diagnostics.sourceSha256) {
    base.recovery = {
      backupPath: diagnostics.backupPath,
      sourceSha256: diagnostics.sourceSha256,
    };
  }
  return base;
}

export function isMediaCatalogRoleDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:\b403\b|ROLE_FORBIDDEN)/i.test(message);
}
