import fs from 'node:fs/promises';
import path from 'node:path';

const queues = new Map<string, Promise<unknown>>();

export type SerializedJsonMutationOptions = {
  retries?: number;
  tempLabel?: string;
};

async function readSnapshot(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '[]';
    throw error;
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(directoryPath, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EISDIR', 'EINVAL', 'EPERM', 'EACCES', 'ENOTSUP'].includes(String(code))) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeDurableTemp(tempPath: string, content: string): Promise<void> {
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Serializes media-index mutations inside this Electron process while retaining
 * optimistic compare-before-rename retries for legacy writers that have not yet
 * migrated to this boundary. The mutation always receives the latest JSON array
 * snapshot and must return the complete next array.
 *
 * A missing index is treated as an empty catalog so first-run ingestion can use
 * the same mutation boundary instead of falling back to an unsafe direct write.
 * Successful commits fsync the temporary file before rename and then best-effort
 * fsync the parent directory, reducing the chance of a power-loss window where a
 * rename is acknowledged but not durably recorded by the filesystem.
 */
export async function mutateSerializedJsonArray<T>(
  filePath: string,
  mutate: (rows: T[]) => T[] | Promise<T[]>,
  options: SerializedJsonMutationOptions = {},
): Promise<T[]> {
  const previous = queues.get(filePath) ?? Promise.resolve();
  const retries = Math.max(1, Math.floor(options.retries ?? 5));
  const tempLabel = String(options.tempLabel || 'mutation').replace(/[^a-z0-9_-]/gi, '_');

  const task = previous.catch(() => undefined).then(async () => {
    const directoryPath = path.dirname(filePath);
    await fs.mkdir(directoryPath, { recursive: true });
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const before = await readSnapshot(filePath);
      const parsed = JSON.parse(before) as unknown;
      if (!Array.isArray(parsed)) throw new Error('MEDIA_INDEX_INVALID');
      const next = await mutate(parsed as T[]);
      if (!Array.isArray(next)) throw new Error('MEDIA_INDEX_MUTATION_INVALID');

      const temp = `${filePath}.${process.pid}.${Date.now()}.${attempt}.${tempLabel}.tmp`;
      try {
        await writeDurableTemp(temp, JSON.stringify(next, null, 2));
        const current = await readSnapshot(filePath);
        if (current !== before) continue;
        await fs.rename(temp, filePath);
        await syncDirectory(directoryPath);
        return next;
      } finally {
        await fs.rm(temp, { force: true }).catch(() => undefined);
      }
    }
    throw new Error('MEDIA_INDEX_CONCURRENT_WRITE_RETRY_EXHAUSTED');
  });

  const settled = task.then(() => undefined, () => undefined);
  queues.set(filePath, settled);
  try {
    return await task;
  } finally {
    if (queues.get(filePath) === settled) queues.delete(filePath);
  }
}
