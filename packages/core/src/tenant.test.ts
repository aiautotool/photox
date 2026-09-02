import { describe, expect, it } from 'vitest';
import { findWorkspaceRow, migrateLegacyWorkspaceRows, replaceWorkspaceRows, rowsForWorkspace } from './tenant.js';

type Row = { key: string; workspaceId?: string; value: string };

describe('tenant row helpers', () => {
  it('migrates only legacy unscoped rows into the default workspace', () => {
    const source: Row[] = [
      { key: 'legacy', value: 'old' },
      { key: 'b', workspaceId: 'workspace-b', value: 'other' },
    ];
    const result = migrateLegacyWorkspaceRows(source, 'workspace-a');
    expect(result.migrated).toBe(true);
    expect(result.rows).toEqual([
      { key: 'legacy', workspaceId: 'workspace-a', value: 'old' },
      { key: 'b', workspaceId: 'workspace-b', value: 'other' },
    ]);
  });

  it('never returns a matching key from another workspace', () => {
    const rows: Row[] = [
      { key: 'same-key', workspaceId: 'workspace-a', value: 'A' },
      { key: 'same-key', workspaceId: 'workspace-b', value: 'B' },
    ];
    expect(rowsForWorkspace(rows, 'workspace-a')).toEqual([rows[0]]);
    expect(findWorkspaceRow(rows as (Row & { key: string })[], 'workspace-a', 'same-key')?.value).toBe('A');
    expect(findWorkspaceRow(rows as (Row & { key: string })[], 'workspace-c', 'same-key')).toBeUndefined();
  });

  it('replaces one workspace without deleting another workspace rows', () => {
    const all: Row[] = [
      { key: 'a1', workspaceId: 'workspace-a', value: 'old-a' },
      { key: 'b1', workspaceId: 'workspace-b', value: 'keep-b' },
    ];
    const next = replaceWorkspaceRows(all, 'workspace-a', [
      { key: 'a2', workspaceId: 'workspace-a', value: 'new-a' },
    ]);
    expect(next).toEqual([
      { key: 'b1', workspaceId: 'workspace-b', value: 'keep-b' },
      { key: 'a2', workspaceId: 'workspace-a', value: 'new-a' },
    ]);
  });

  it('rejects cross-workspace data in a scoped replacement', () => {
    expect(() => replaceWorkspaceRows<Row>([], 'workspace-a', [
      { key: 'evil', workspaceId: 'workspace-b', value: 'cross-tenant' },
    ])).toThrow('WORKSPACE_ROW_SCOPE_MISMATCH');
  });
});
