export type PhysicalResumableAcceptanceDiagnostics = {
  initialized: boolean;
  accepted: boolean;
  releaseCommitSha?: string;
  requiredPlatforms: string[];
  acceptedPlatforms: string[];
  blockers: string[];
  evidenceCount: number;
  persistenceHealthy: boolean;
};

export type LegacyWholeFileCompatibilityDiagnostics =
  | {
      initialized: false;
      physicalResumableAcceptance?: PhysicalResumableAcceptanceDiagnostics;
      deprecationReadiness: {
        ready: false;
        physicalDeviceResumableAccepted: false;
        blockers: string[];
      };
    }
  | {
      initialized: true;
      physicalResumableAcceptance?: PhysicalResumableAcceptanceDiagnostics;
      snapshot: {
        observedSince: string;
        observedUntil: string;
        total: number;
        byAuthMode: { bearer: number; 'pair-code': number; 'pairing-challenge': number };
        byOutcome: { accepted: number; duplicate: number; rejected: number };
        lastObservedAt?: string;
      };
      deprecationReadiness: {
        ready: boolean;
        physicalDeviceResumableAccepted: boolean;
        minimumObservationMs: number;
        observedForMs: number;
        compatibilityRequests: number;
        blockers: string[];
      };
      persistence: {
        healthy: boolean;
        lastPersistedAt?: string;
        lastErrorAt?: string;
      };
    };

export type LegacyWholeFileOperationsView = {
  initialized: boolean;
  status: 'ready' | 'monitoring' | 'attention';
  statusLabel: string;
  total: number;
  bearer: number;
  pairCode: number;
  pairingChallenge: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  persistenceLabel: string;
  persistenceHealthy: boolean;
  observedSince?: string;
  lastObservedAt?: string;
  lastPersistedAt?: string;
  physicalDeviceResumableAccepted: boolean;
  physicalEvidenceInitialized: boolean;
  physicalEvidencePersistenceHealthy: boolean;
  physicalEvidenceCount: number;
  physicalReleaseCommitSha?: string;
  physicalRequiredPlatforms: string[];
  physicalAcceptedPlatforms: string[];
  physicalEvidenceBlockers: string[];
  observationProgressPercent: number;
  blockers: string[];
  blockerLabels: string[];
};

const BLOCKER_LABELS: Record<string, string> = {
  TELEMETRY_RUNTIME_NOT_INITIALIZED: 'Telemetry chưa được khởi tạo',
  TELEMETRY_PERSISTENCE_UNHEALTHY: 'Lưu telemetry chưa ổn định',
  PHYSICAL_DEVICE_RESUMABLE_NOT_ACCEPTED: 'Chưa có acceptance test resumable trên thiết bị thật',
  OBSERVATION_WINDOW_INCOMPLETE: 'Chưa đủ cửa sổ quan sát compatibility',
  COMPATIBILITY_TRAFFIC_OBSERVED: 'Vẫn còn client dùng whole-file compatibility route',
};

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function blockerLabel(value: string): string {
  return BLOCKER_LABELS[value] ?? value.replaceAll('_', ' ').toLowerCase();
}

function physicalEvidenceView(diagnostics: LegacyWholeFileCompatibilityDiagnostics | undefined) {
  const physical = diagnostics?.physicalResumableAcceptance;
  return {
    physicalEvidenceInitialized: physical?.initialized ?? false,
    physicalEvidencePersistenceHealthy: physical?.persistenceHealthy ?? false,
    physicalEvidenceCount: safeCount(physical?.evidenceCount),
    physicalReleaseCommitSha: physical?.releaseCommitSha,
    physicalRequiredPlatforms: [...(physical?.requiredPlatforms ?? ['ios', 'android'])],
    physicalAcceptedPlatforms: [...(physical?.acceptedPlatforms ?? [])],
    physicalEvidenceBlockers: [...(physical?.blockers ?? ['PHYSICAL_RESUMABLE_EVIDENCE_NOT_INITIALIZED'])],
  };
}

export function buildLegacyWholeFileOperationsView(
  diagnostics: LegacyWholeFileCompatibilityDiagnostics | undefined,
): LegacyWholeFileOperationsView {
  const physical = physicalEvidenceView(diagnostics);
  if (!diagnostics || !diagnostics.initialized) {
    const blockers = diagnostics?.deprecationReadiness.blockers ?? ['TELEMETRY_RUNTIME_NOT_INITIALIZED'];
    return {
      initialized: false,
      status: 'attention',
      statusLabel: 'Compatibility telemetry chưa sẵn sàng',
      total: 0,
      bearer: 0,
      pairCode: 0,
      pairingChallenge: 0,
      accepted: 0,
      duplicate: 0,
      rejected: 0,
      persistenceLabel: 'Chưa khởi tạo',
      persistenceHealthy: false,
      physicalDeviceResumableAccepted: false,
      ...physical,
      observationProgressPercent: 0,
      blockers,
      blockerLabels: blockers.map(blockerLabel),
    };
  }

  const { snapshot, deprecationReadiness: readiness, persistence } = diagnostics;
  const observationProgressPercent = readiness.minimumObservationMs <= 0
    ? 100
    : Math.min(100, Math.max(0, Math.round((readiness.observedForMs / readiness.minimumObservationMs) * 100)));
  const status = readiness.ready ? 'ready' : persistence.healthy ? 'monitoring' : 'attention';
  const statusLabel = readiness.ready
    ? 'Đủ điều kiện xem xét retire whole-file route'
    : persistence.healthy
      ? 'Đang theo dõi compatibility route'
      : 'Telemetry cần kiểm tra';

  return {
    initialized: true,
    status,
    statusLabel,
    total: safeCount(snapshot.total),
    bearer: safeCount(snapshot.byAuthMode.bearer),
    pairCode: safeCount(snapshot.byAuthMode['pair-code']),
    pairingChallenge: safeCount(snapshot.byAuthMode['pairing-challenge']),
    accepted: safeCount(snapshot.byOutcome.accepted),
    duplicate: safeCount(snapshot.byOutcome.duplicate),
    rejected: safeCount(snapshot.byOutcome.rejected),
    persistenceLabel: persistence.healthy ? 'Bền vững / healthy' : 'Không healthy',
    persistenceHealthy: persistence.healthy,
    observedSince: snapshot.observedSince,
    lastObservedAt: snapshot.lastObservedAt,
    lastPersistedAt: persistence.lastPersistedAt,
    physicalDeviceResumableAccepted: readiness.physicalDeviceResumableAccepted,
    ...physical,
    observationProgressPercent,
    blockers: [...readiness.blockers],
    blockerLabels: readiness.blockers.map(blockerLabel),
  };
}
