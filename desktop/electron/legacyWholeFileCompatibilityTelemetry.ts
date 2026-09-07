export type LegacyWholeFileAuthMode = 'bearer' | 'pair-code' | 'pairing-challenge';
export type LegacyWholeFileOutcome = 'accepted' | 'duplicate' | 'rejected';

export type LegacyWholeFileCompatibilityEvent = {
  authMode: LegacyWholeFileAuthMode;
  outcome: LegacyWholeFileOutcome;
  at: number;
};

export type LegacyWholeFileCompatibilitySnapshot = {
  observedSince: string;
  observedUntil: string;
  total: number;
  byAuthMode: Record<LegacyWholeFileAuthMode, number>;
  byOutcome: Record<LegacyWholeFileOutcome, number>;
  lastObservedAt?: string;
};

export type LegacyWholeFileDeprecationReadiness = {
  ready: boolean;
  physicalDeviceResumableAccepted: boolean;
  minimumObservationMs: number;
  observedForMs: number;
  compatibilityRequests: number;
  blockers: string[];
};

export type LegacyWholeFileCompatibilityPersistedState = {
  version: 1;
  observedSince: number;
  total: number;
  byAuthMode: Record<LegacyWholeFileAuthMode, number>;
  byOutcome: Record<LegacyWholeFileOutcome, number>;
  lastObservedAt?: number;
};

export type LegacyWholeFileCompatibilityTelemetryOptions = {
  now?: () => number;
  minimumObservationMs?: number;
  persistedState?: unknown;
};

const DEFAULT_MINIMUM_OBSERVATION_MS = 7 * 24 * 60 * 60 * 1000;

const AUTH_MODES: LegacyWholeFileAuthMode[] = ['bearer', 'pair-code', 'pairing-challenge'];
const OUTCOMES: LegacyWholeFileOutcome[] = ['accepted', 'duplicate', 'rejected'];

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseCounterRecord<T extends string>(value: unknown, keys: readonly T[]): Record<T, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const parsed = {} as Record<T, number>;
  for (const key of keys) {
    if (!isNonNegativeInteger(record[key])) return undefined;
    parsed[key] = record[key] as number;
  }
  return parsed;
}

export function parseLegacyWholeFileCompatibilityPersistedState(
  value: unknown,
): LegacyWholeFileCompatibilityPersistedState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || !isFiniteTimestamp(state.observedSince) || !isNonNegativeInteger(state.total)) return undefined;

  const byAuthMode = parseCounterRecord(state.byAuthMode, AUTH_MODES);
  const byOutcome = parseCounterRecord(state.byOutcome, OUTCOMES);
  if (!byAuthMode || !byOutcome) return undefined;

  const authTotal = AUTH_MODES.reduce((sum, key) => sum + byAuthMode[key], 0);
  const outcomeTotal = OUTCOMES.reduce((sum, key) => sum + byOutcome[key], 0);
  if (authTotal !== state.total || outcomeTotal !== state.total) return undefined;

  const lastObservedAt = state.lastObservedAt;
  if (lastObservedAt !== undefined && (!isFiniteTimestamp(lastObservedAt) || lastObservedAt < state.observedSince)) {
    return undefined;
  }
  if (state.total === 0 && lastObservedAt !== undefined) return undefined;
  if (state.total > 0 && lastObservedAt === undefined) return undefined;

  return {
    version: 1,
    observedSince: state.observedSince,
    total: state.total,
    byAuthMode,
    byOutcome,
    lastObservedAt,
  };
}

/**
 * Compatibility telemetry for the legacy whole-file receiver.
 *
 * Deliberately records only coarse auth mode/outcome/time. It never stores
 * tokens, pairing credentials, workspace IDs, device IDs, filenames, media
 * keys, addresses, or request headers. Persisted state is versioned and
 * strictly validated so corrupt/unknown state starts a fresh observation
 * window rather than accidentally making route retirement look safe.
 */
export class LegacyWholeFileCompatibilityTelemetry {
  private readonly now: () => number;
  private readonly minimumObservationMs: number;
  private readonly observedSince: number;
  private total = 0;
  private lastObservedAt: number | undefined;
  private readonly byAuthMode: Record<LegacyWholeFileAuthMode, number> = {
    bearer: 0,
    'pair-code': 0,
    'pairing-challenge': 0,
  };
  private readonly byOutcome: Record<LegacyWholeFileOutcome, number> = {
    accepted: 0,
    duplicate: 0,
    rejected: 0,
  };

  constructor(options: LegacyWholeFileCompatibilityTelemetryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.minimumObservationMs = Math.max(0, options.minimumObservationMs ?? DEFAULT_MINIMUM_OBSERVATION_MS);
    const persistedState = parseLegacyWholeFileCompatibilityPersistedState(options.persistedState);
    this.observedSince = persistedState?.observedSince ?? this.now();
    if (persistedState) {
      this.total = persistedState.total;
      this.lastObservedAt = persistedState.lastObservedAt;
      Object.assign(this.byAuthMode, persistedState.byAuthMode);
      Object.assign(this.byOutcome, persistedState.byOutcome);
    }
  }

  record(event: Omit<LegacyWholeFileCompatibilityEvent, 'at'> & { at?: number }): void {
    const at = Number.isFinite(event.at) ? Number(event.at) : this.now();
    this.total += 1;
    this.byAuthMode[event.authMode] += 1;
    this.byOutcome[event.outcome] += 1;
    this.lastObservedAt = Math.max(this.lastObservedAt ?? at, at);
  }

  exportPersistedState(): LegacyWholeFileCompatibilityPersistedState {
    return {
      version: 1,
      observedSince: this.observedSince,
      total: this.total,
      byAuthMode: { ...this.byAuthMode },
      byOutcome: { ...this.byOutcome },
      lastObservedAt: this.lastObservedAt,
    };
  }

  snapshot(at = this.now()): LegacyWholeFileCompatibilitySnapshot {
    return {
      observedSince: new Date(this.observedSince).toISOString(),
      observedUntil: new Date(at).toISOString(),
      total: this.total,
      byAuthMode: { ...this.byAuthMode },
      byOutcome: { ...this.byOutcome },
      lastObservedAt: this.lastObservedAt === undefined ? undefined : new Date(this.lastObservedAt).toISOString(),
    };
  }

  deprecationReadiness(input: { physicalDeviceResumableAccepted: boolean; at?: number }): LegacyWholeFileDeprecationReadiness {
    const at = Number.isFinite(input.at) ? Number(input.at) : this.now();
    const observedForMs = Math.max(0, at - this.observedSince);
    const blockers: string[] = [];
    if (!input.physicalDeviceResumableAccepted) blockers.push('PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED');
    if (observedForMs < this.minimumObservationMs) blockers.push('OBSERVATION_WINDOW_INCOMPLETE');
    if (this.total > 0) blockers.push('COMPATIBILITY_TRAFFIC_OBSERVED');
    return {
      ready: blockers.length === 0,
      physicalDeviceResumableAccepted: input.physicalDeviceResumableAccepted,
      minimumObservationMs: this.minimumObservationMs,
      observedForMs,
      compatibilityRequests: this.total,
      blockers,
    };
  }
}
