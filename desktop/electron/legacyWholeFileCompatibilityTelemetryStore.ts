import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  LegacyWholeFileCompatibilityTelemetry,
  type LegacyWholeFileCompatibilityTelemetryOptions,
} from './legacyWholeFileCompatibilityTelemetry.js';

export type LegacyWholeFileCompatibilityTelemetryStoreOptions = Omit<
  LegacyWholeFileCompatibilityTelemetryOptions,
  'persistedState'
>;

/**
 * Durable, credential-free persistence for legacy whole-file compatibility telemetry.
 *
 * Writes use a same-directory temporary file followed by rename so a Desktop
 * process/power interruption cannot leave a partially-written authoritative
 * observation state. Corrupt or unknown persisted content is intentionally
 * treated as absent by the telemetry constructor, which restarts the minimum
 * observation window and therefore fails closed for route deprecation.
 */
export class LegacyWholeFileCompatibilityTelemetryStore {
  constructor(private readonly filePath: string) {}

  async load(options: LegacyWholeFileCompatibilityTelemetryStoreOptions = {}): Promise<LegacyWholeFileCompatibilityTelemetry> {
    let persistedState: unknown;
    try {
      persistedState = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    return new LegacyWholeFileCompatibilityTelemetry({ ...options, persistedState });
  }

  async save(telemetry: LegacyWholeFileCompatibilityTelemetry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(telemetry.exportPersistedState())}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
