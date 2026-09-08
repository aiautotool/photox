import path from 'node:path';
import type { LegacyWholeFileCompatibilityEvent } from './legacyWholeFileCompatibilityTelemetry.js';
import { LegacyWholeFileCompatibilityTelemetryRuntime, type LegacyWholeFileCompatibilityRuntimeDiagnostics } from './legacyWholeFileCompatibilityTelemetryRuntime.js';
import { LegacyWholeFileCompatibilityTelemetryStore } from './legacyWholeFileCompatibilityTelemetryStore.js';

export type LegacyWholeFileCompatibilityProductionDiagnostics =
  | ({ initialized: true } & LegacyWholeFileCompatibilityRuntimeDiagnostics)
  | {
      initialized: false;
      deprecationReadiness: {
        ready: false;
        physicalDeviceResumableAccepted: false;
        blockers: ['TELEMETRY_RUNTIME_NOT_INITIALIZED'];
      };
    };

let runtime: LegacyWholeFileCompatibilityTelemetryRuntime | null = null;
let initializing: Promise<void> | null = null;

/**
 * Initializes the durable compatibility telemetry runtime from the same
 * authoritative Desktop state directory that contains media-index.json.
 * Repeated startup calls are idempotent.
 */
export async function initializeLegacyWholeFileCompatibilityTelemetry(stateDirectory: string): Promise<void> {
  if (runtime) return;
  if (initializing) return initializing;
  initializing = (async () => {
    const store = new LegacyWholeFileCompatibilityTelemetryStore(
      path.join(stateDirectory, 'legacy-whole-file-compatibility.json'),
    );
    runtime = await LegacyWholeFileCompatibilityTelemetryRuntime.create(store, {
      onPersistenceError: error => console.error('PhotoX whole-file compatibility telemetry persistence failed', error),
    });
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

/**
 * Best-effort by contract: compatibility telemetry must never change media
 * ingest success/failure semantics. Runtime persistence failures are tracked
 * internally and fail-close deprecation readiness instead.
 */
export function recordLegacyWholeFileCompatibility(
  event: Omit<LegacyWholeFileCompatibilityEvent, 'at'> & { at?: number },
): void {
  runtime?.record(event);
}

export function legacyWholeFileCompatibilityDiagnostics(): LegacyWholeFileCompatibilityProductionDiagnostics {
  if (!runtime) {
    return {
      initialized: false,
      deprecationReadiness: {
        ready: false,
        physicalDeviceResumableAccepted: false,
        blockers: ['TELEMETRY_RUNTIME_NOT_INITIALIZED'],
      },
    };
  }
  return {
    initialized: true,
    ...runtime.diagnostics({ physicalDeviceResumableAccepted: false }),
  };
}

export async function flushLegacyWholeFileCompatibilityTelemetry(): Promise<void> {
  await runtime?.flush();
}

/** Test-only reset keeps production callers free of mutable runtime plumbing. */
export function resetLegacyWholeFileCompatibilityTelemetryForTests(): void {
  runtime = null;
  initializing = null;
}
