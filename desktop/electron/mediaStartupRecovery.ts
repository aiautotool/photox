import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export type RecoveryCatalogRow = {
  workspaceId: string;
  key: string;
  path: string;
  deletion?: { state: 'deleting'; claimId: string; startedAt: string };
};

export type IngestRecoveryEntry = {
  version: 1;
  journalId: string;
  workspaceId: string;
  key: string;
  tmpPath: string;
  targetPath: string;
  createdAt: string;
};

export type IngestRecoveryResult = {
  scanned: number;
  committed: number;
  rolledBack: number;
  invalid: { file: string; reason: string }[];
};

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function syncDirectory(dir: string) {
  try {
    const handle = await fs.open(dir, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch {
    // Directory fsync is best-effort on platforms/filesystems that do not expose it.
  }
}

function validateEntry(value: unknown): IngestRecoveryEntry {
  const entry = value as Partial<IngestRecoveryEntry>;
  if (entry?.version !== 1) throw new Error('UNSUPPORTED_VERSION');
  for (const field of ['journalId', 'workspaceId', 'key', 'tmpPath', 'targetPath', 'createdAt'] as const) {
    if (typeof entry[field] !== 'string' || !entry[field]) throw new Error(`INVALID_${field.toUpperCase()}`);
  }
  return entry as IngestRecoveryEntry;
}

export function createMediaIngestRecoveryJournal(input: {
  journalDir: string;
  libraryRoot: string;
  incomingRoot: string;
}) {
  const { journalDir, libraryRoot, incomingRoot } = input;

  function assertSafePaths(tmpPath: string, targetPath: string) {
    if (!isWithin(incomingRoot, tmpPath)) throw new Error('RECOVERY_TMP_OUTSIDE_INCOMING_ROOT');
    if (!isWithin(libraryRoot, targetPath)) throw new Error('RECOVERY_TARGET_OUTSIDE_LIBRARY_ROOT');
  }

  return {
    async begin(entry: Omit<IngestRecoveryEntry, 'version' | 'journalId' | 'createdAt'>) {
      assertSafePaths(entry.tmpPath, entry.targetPath);
      await fs.mkdir(journalDir, { recursive: true });
      const record: IngestRecoveryEntry = {
        version: 1,
        journalId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...entry,
      };
      const finalPath = path.join(journalDir, `${record.journalId}.json`);
      const tempPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
      const handle = await fs.open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tempPath, finalPath);
      await syncDirectory(journalDir);
      return record;
    },

    async complete(journalId: string) {
      if (!journalId) throw new Error('RECOVERY_JOURNAL_ID_REQUIRED');
      await fs.unlink(path.join(journalDir, `${journalId}.json`)).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      await syncDirectory(journalDir);
    },

    async recover(rows: RecoveryCatalogRow[]): Promise<IngestRecoveryResult> {
      await fs.mkdir(journalDir, { recursive: true });
      const names = (await fs.readdir(journalDir)).filter(name => name.endsWith('.json'));
      const result: IngestRecoveryResult = { scanned: names.length, committed: 0, rolledBack: 0, invalid: [] };
      for (const name of names) {
        const journalPath = path.join(journalDir, name);
        let entry: IngestRecoveryEntry;
        try {
          entry = validateEntry(JSON.parse(await fs.readFile(journalPath, 'utf8')));
          assertSafePaths(entry.tmpPath, entry.targetPath);
        } catch (error) {
          result.invalid.push({ file: name, reason: error instanceof Error ? error.message : String(error) });
          continue;
        }
        const committed = rows.some(row => row.workspaceId === entry.workspaceId && row.key === entry.key && path.resolve(row.path) === path.resolve(entry.targetPath));
        if (committed) {
          await fs.unlink(entry.tmpPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
          await fs.unlink(journalPath);
          result.committed += 1;
          continue;
        }
        await fs.unlink(entry.targetPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        await fs.unlink(entry.tmpPath).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        await fs.unlink(journalPath);
        result.rolledBack += 1;
      }
      if (names.length) await syncDirectory(journalDir);
      return result;
    },
  };
}

export async function recoverDeletionTombstones<T extends RecoveryCatalogRow>(
  rows: T[],
  resume: (row: T) => Promise<unknown>,
) {
  const deleting = rows.filter(row => row.deletion?.state === 'deleting' && row.deletion.claimId);
  const failures: { workspaceId: string; key: string; error: string }[] = [];
  let recovered = 0;
  for (const row of deleting) {
    try {
      await resume(row);
      recovered += 1;
    } catch (error) {
      failures.push({ workspaceId: row.workspaceId, key: row.key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { attempted: deleting.length, recovered, failures };
}
