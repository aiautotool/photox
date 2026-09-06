import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { migrateLegacyWorkspaceRows } from '@photosync/core';

export type LegacyMediaIndexPreparationResult = {
  status: 'SOURCE_MISSING' | 'ALREADY_SCOPED' | 'MIGRATED';
  migratedRows: number;
  removedStaleTemps: number;
};

type LegacyRow = Record<string, unknown> & { workspaceId?: string };

async function removeStaleMigrationTemps(indexPath: string): Promise<number> {
  const directory = path.dirname(indexPath);
  const prefix = `${path.basename(indexPath)}.`;
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.migrating')) continue;
    try {
      await fs.unlink(path.join(directory, name));
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Directory fsync is unsupported on some platforms/filesystems. File fsync +
    // atomic rename still gives the strongest portable guarantee available here.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EISDIR' && code !== 'EPERM') throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Makes a legacy JSON media index tenant-scoped before the one-time SQLite import.
 *
 * Crash contract:
 * - the source file is never modified in-place;
 * - a fully-written + fsync'd unique temp is atomically renamed over the source;
 * - an interrupted pre-rename run leaves the original authoritative source intact;
 * - orphaned `*.migrating` files are ignored and removed on the next startup;
 * - invalid/corrupt JSON fails closed and is never replaced.
 */
export async function prepareLegacyMediaIndexForSqlite(options: {
  indexPath: string;
  workspaceId: string;
}): Promise<LegacyMediaIndexPreparationResult> {
  if (!options.indexPath) throw new Error('LEGACY_MEDIA_INDEX_PATH_REQUIRED');
  if (!options.workspaceId.trim()) throw new Error('LEGACY_MEDIA_INDEX_WORKSPACE_REQUIRED');

  const removedStaleTemps = await removeStaleMigrationTemps(options.indexPath);
  let text: string;
  try {
    text = await fs.readFile(options.indexPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'SOURCE_MISSING', migratedRows: 0, removedStaleTemps };
    }
    throw error;
  }

  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error('LEGACY_MEDIA_INDEX_ARRAY_REQUIRED');
  for (const [index, row] of raw.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`LEGACY_MEDIA_INDEX_ROW_INVALID:${index}`);
    }
  }

  const migrated = migrateLegacyWorkspaceRows(raw as LegacyRow[], options.workspaceId);
  if (!migrated.migrated) {
    return { status: 'ALREADY_SCOPED', migratedRows: 0, removedStaleTemps };
  }

  const directory = path.dirname(options.indexPath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = `${options.indexPath}.${crypto.randomUUID()}.migrating`;
  let renamed = false;
  try {
    const handle = await fs.open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(migrated.rows, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, options.indexPath);
    renamed = true;
    await syncDirectory(directory);
  } finally {
    if (!renamed) await fs.unlink(tempPath).catch(() => undefined);
  }

  return {
    status: 'MIGRATED',
    migratedRows: migrated.rows.length,
    removedStaleTemps,
  };
}
