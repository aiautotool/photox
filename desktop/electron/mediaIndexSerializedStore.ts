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

/**
 * Serializes media-index mutations inside this Electron process while retaining
 * optimistic compare-before-rename retries for legacy writers that have not yet
 * migrated to this boundary. The mutation always receives the latest JSON array
 * snapshot and must return the complete next array.
 *
 * A missing index is treated as an empty catalog so first-run ingestion can use
 * the same mutation boundary instead of falling back to an unsafe direct write.
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
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const before = await readSnapshot(filePath);
      const parsed = JSON.parse(before) as unknown;
      if (!Array.isArray(parsed)) throw new Error('MEDIA_INDEX_INVALID');
      const next = await mutate(parsed as T[]);
      if (!Array.isArray(next)) throw new Error('MEDIA_INDEX_MUTATION_INVALID');

      const temp = `${filePath}.${process.pid}.${Date.now()}.${attempt}.${tempLabel}.tmp`;
      await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
      const current = await readSnapshot(filePath);
      if (current !== before) {
        await fs.rm(temp, { force: true });
        continue;
      }
      await fs.rename(temp, filePath);
      return next;
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
