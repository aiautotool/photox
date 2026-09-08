import {
  LegacyWholeFileCompatibilityTelemetry,
  type LegacyWholeFileCompatibilityEvent,
  type LegacyWholeFileCompatibilitySnapshot,
  type LegacyWholeFileDeprecationReadiness,
  type LegacyWholeFileCompatibilityTelemetryOptions,
} from './legacyWholeFileCompatibilityTelemetry.js';
import { LegacyWholeFileCompatibilityTelemetryStore } from './legacyWholeFileCompatibilityTelemetryStore.js';

export type LegacyWholeFileCompatibilityTelemetryStoreLike = Pick<
  LegacyWholeFileCompatibilityTelemetryStore,
  'load' | 'save'
>;

export type LegacyWholeFileCompatibilityTelemetryRuntimeOptions = Omit<
  LegacyWholeFileCompatibilityTelemetryOptions,
  'persistedState'
> & {
  onPersistenceError?: (error: unknown) => void;
};

export type LegacyWholeFileCompatibilityPersistenceDiagnostics = {
  healthy: boolean;
  lastPersistedAt?: string;
  lastErrorAt?: string;
};

export type LegacyWholeFileCompatibilityRuntimeDiagnostics = {
  snapshot: LegacyWholeFileCompatibilitySnapshot;
  deprecationReadiness: LegacyWholeFileDeprecationReadiness;
  persistence: LegacyWholeFileCompatibilityPersistenceDiagnostics;
};

/**
 * Production-facing coordinator for compatibility telemetry.
 *
 * Recording is additive and never allowed to fail a media request. Persistence
 * is serialized so a slower older write cannot replace a newer snapshot. Any
 * load/save failure blocks deprecation readiness until a later successful save,
 * because losing compatibility evidence across restart must fail closed.
 */
export class LegacyWholeFileCompatibilityTelemetryRuntime {
  private writeQueue: Promise<void> = Promise.resolve();
  private persistenceHealthy: boolean;
  private lastPersistedAt: number | undefined;
  private lastErrorAt: number | undefined;

  private constructor(
    private readonly store: LegacyWholeFileCompatibilityTelemetryStoreLike,
    private readonly telemetry: LegacyWholeFileCompatibilityTelemetry,
    private readonly now: () => number,
    private readonly onPersistenceError: (error: unknown) => void,
    initialPersistenceHealthy: boolean,
  ) {
    this.persistenceHealthy = initialPersistenceHealthy;
  }

  static async create(
    store: LegacyWholeFileCompatibilityTelemetryStoreLike,
    options: LegacyWholeFileCompatibilityTelemetryRuntimeOptions = {},
  ): Promise<LegacyWholeFileCompatibilityTelemetryRuntime> {
    const now = options.now ?? Date.now;
    const onPersistenceError = options.onPersistenceError ?? (() => undefined);
    try {
      const telemetry = await store.load({ now, minimumObservationMs: options.minimumObservationMs });
      return new LegacyWholeFileCompatibilityTelemetryRuntime(store, telemetry, now, onPersistenceError, true);
    } catch (error) {
      onPersistenceError(error);
      const telemetry = new LegacyWholeFileCompatibilityTelemetry({ now, minimumObservationMs: options.minimumObservationMs });
      const runtime = new LegacyWholeFileCompatibilityTelemetryRuntime(store, telemetry, now, onPersistenceError, false);
      runtime.lastErrorAt = now();
      return runtime;
    }
  }

  record(event: Omit<LegacyWholeFileCompatibilityEvent, 'at'> & { at?: number }): void {
    this.telemetry.record(event);
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        await this.store.save(this.telemetry);
        this.persistenceHealthy = true;
        this.lastPersistedAt = this.now();
      } catch (error) {
        this.persistenceHealthy = false;
        this.lastErrorAt = this.now();
        this.onPersistenceError(error);
      }
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  diagnostics(input: { physicalDeviceResumableAccepted?: boolean; at?: number } = {}): LegacyWholeFileCompatibilityRuntimeDiagnostics {
    const at = Number.isFinite(input.at) ? Number(input.at) : this.now();
    const readiness = this.telemetry.deprecationReadiness({
      physicalDeviceResumableAccepted: input.physicalDeviceResumableAccepted === true,
      at,
    });
    if (!this.persistenceHealthy && !readiness.blockers.includes('TELEMETRY_PERSISTENCE_UNHEALTHY')) {
      readiness.blockers.push('TELEMETRY_PERSISTENCE_UNHEALTHY');
      readiness.ready = false;
    }
    return {
      snapshot: this.telemetry.snapshot(at),
      deprecationReadiness: readiness,
      persistence: {
        healthy: this.persistenceHealthy,
        lastPersistedAt: this.lastPersistedAt === undefined ? undefined : new Date(this.lastPersistedAt).toISOString(),
        lastErrorAt: this.lastErrorAt === undefined ? undefined : new Date(this.lastErrorAt).toISOString(),
      },
    };
  }
}
