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

export type LegacyWholeFileCompatibilityTelemetryOptions = {
  now?: () => number;
  minimumObservationMs?: number;
};

const DEFAULT_MINIMUM_OBSERVATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Process-local compatibility telemetry for the legacy whole-file receiver.
 *
 * Deliberately records only coarse auth mode/outcome/time. It never stores
 * tokens, pairing credentials, workspace IDs, device IDs, filenames, media
 * keys, addresses, or request headers.
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
    this.observedSince = this.now();
  }

  record(event: Omit<LegacyWholeFileCompatibilityEvent, 'at'> & { at?: number }): void {
    const at = Number.isFinite(event.at) ? Number(event.at) : this.now();
    this.total += 1;
    this.byAuthMode[event.authMode] += 1;
    this.byOutcome[event.outcome] += 1;
    this.lastObservedAt = Math.max(this.lastObservedAt ?? at, at);
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
