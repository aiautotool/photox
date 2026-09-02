export type WorkspaceOwned = { workspaceId?: string };

export function migrateLegacyWorkspaceRows<T extends WorkspaceOwned>(
  rows: readonly T[],
  legacyWorkspaceId: string,
): { rows: (T & { workspaceId: string })[]; migrated: boolean } {
  let migrated = false;
  const scoped = rows.map(row => {
    if (row.workspaceId) return row as T & { workspaceId: string };
    migrated = true;
    return { ...row, workspaceId: legacyWorkspaceId };
  });
  return { rows: scoped, migrated };
}

export function rowsForWorkspace<T extends WorkspaceOwned>(
  rows: readonly T[],
  workspaceId: string,
): T[] {
  return rows.filter(row => row.workspaceId === workspaceId);
}

export function replaceWorkspaceRows<T extends WorkspaceOwned>(
  allRows: readonly T[],
  workspaceId: string,
  replacement: readonly T[],
): T[] {
  if (replacement.some(row => row.workspaceId !== workspaceId)) {
    throw new Error('WORKSPACE_ROW_SCOPE_MISMATCH');
  }
  return [
    ...allRows.filter(row => row.workspaceId !== workspaceId),
    ...replacement,
  ];
}

export function findWorkspaceRow<T extends WorkspaceOwned & { key: string }>(
  rows: readonly T[],
  workspaceId: string,
  key: string,
): T | undefined {
  return rows.find(row => row.workspaceId === workspaceId && row.key === key);
}
