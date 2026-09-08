import {
  evidenceProvesPhysicalResumableAcceptance,
  type PhysicalResumableAcceptanceEvidence,
  type PhysicalResumablePlatform,
} from './physicalResumableAcceptanceEvidence.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';

type AuthoritativeByteObservation = {
  source: 'server-authoritative';
  bytes: number;
  observedAt: string;
};

type AuthoritativeQuotaObservation = {
  source: 'workspace-authoritative';
  bytes: number;
  observedAt: string;
};

type AuthoritativeCatalogObservation = {
  source: 'catalog-authoritative';
  rows: number;
  observedAt: string;
};

export type PhysicalResumableObservedRun = {
  version: 1;
  runId: string;
  startedAt: string;
  release: {
    appVersion: string;
    buildNumber: string;
    commitSha: string;
  };
  device: {
    platform: PhysicalResumablePlatform;
    model: string;
    osVersion: string;
  };
  scenario: {
    assetSizeBytes: number;
    networkInterruptedAt: string;
    interruptedAfterBytes: number;
    processKilledAt: string;
    appRestartedAt: string;
    offsetAfterRestart: AuthoritativeByteObservation;
    resumeStartedAt: string;
    resumedFromByte: number;
    completedAt: string;
    finalReceivedBytes: number;
    finalAssetVerified: boolean;
    quotaBefore: AuthoritativeQuotaObservation;
    quotaAfter: AuthoritativeQuotaObservation;
    catalogBefore: AuthoritativeCatalogObservation;
    catalogAfter: AuthoritativeCatalogObservation;
  };
};

export type PhysicalResumableCapturedEvidence = {
  evidence: PhysicalResumableAcceptanceEvidence;
  provesAcceptance: boolean;
};

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validIso(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function requireChronology(times: string[]): void {
  if (!times.every(validIso)) throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_TIME');
  for (let index = 1; index < times.length; index += 1) {
    if (Date.parse(times[index]!) < Date.parse(times[index - 1]!)) {
      throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_CHRONOLOGY');
    }
  }
}

function duplicateDelta(actualDelta: number, expectedDelta: number): number {
  if (!Number.isSafeInteger(actualDelta) || !Number.isSafeInteger(expectedDelta)) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_DELTA');
  }
  return Math.max(0, actualDelta - expectedDelta);
}

/**
 * Converts an observed real-device run into immutable acceptance evidence.
 * Duplicate quota/catalog values are derived from authoritative before/after
 * snapshots rather than accepted from an operator-provided pass/fail switch.
 */
export function derivePhysicalResumableEvidenceFromObservedRun(
  observation: PhysicalResumableObservedRun,
): PhysicalResumableCapturedEvidence {
  if (observation.version !== 1 || !nonEmpty(observation.runId)) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_IDENTITY');
  }
  if (!nonEmpty(observation.release.appVersion)
    || !nonEmpty(observation.release.buildNumber)
    || !/^[0-9a-f]{40}$/i.test(observation.release.commitSha)) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_RELEASE');
  }
  if ((observation.device.platform !== 'ios' && observation.device.platform !== 'android')
    || !nonEmpty(observation.device.model)
    || !nonEmpty(observation.device.osVersion)) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_DEVICE');
  }

  const scenario = observation.scenario;
  const integerValues = [
    scenario.assetSizeBytes,
    scenario.interruptedAfterBytes,
    scenario.offsetAfterRestart.bytes,
    scenario.resumedFromByte,
    scenario.finalReceivedBytes,
    scenario.quotaBefore.bytes,
    scenario.quotaAfter.bytes,
    scenario.catalogBefore.rows,
    scenario.catalogAfter.rows,
  ];
  if (!integerValues.every(safeNonNegativeInteger) || scenario.assetSizeBytes === 0) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_COUNTER');
  }
  if (scenario.offsetAfterRestart.source !== 'server-authoritative'
    || scenario.quotaBefore.source !== 'workspace-authoritative'
    || scenario.quotaAfter.source !== 'workspace-authoritative'
    || scenario.catalogBefore.source !== 'catalog-authoritative'
    || scenario.catalogAfter.source !== 'catalog-authoritative') {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_AUTHORITY');
  }

  requireChronology([
    observation.startedAt,
    scenario.quotaBefore.observedAt,
    scenario.catalogBefore.observedAt,
    scenario.networkInterruptedAt,
    scenario.processKilledAt,
    scenario.appRestartedAt,
    scenario.offsetAfterRestart.observedAt,
    scenario.resumeStartedAt,
    scenario.completedAt,
    scenario.quotaAfter.observedAt,
    scenario.catalogAfter.observedAt,
  ]);

  const quotaDelta = scenario.quotaAfter.bytes - scenario.quotaBefore.bytes;
  const catalogDelta = scenario.catalogAfter.rows - scenario.catalogBefore.rows;
  if (quotaDelta < 0 || catalogDelta < 0) {
    throw new Error('INVALID_PHYSICAL_RESUMABLE_CAPTURE_AUTHORITATIVE_DELTA');
  }

  const evidence: PhysicalResumableAcceptanceEvidence = {
    version: 1,
    evidenceId: observation.runId,
    recordedAt: scenario.catalogAfter.observedAt,
    release: {
      ...observation.release,
      commitSha: observation.release.commitSha.toLowerCase(),
    },
    device: { ...observation.device },
    scenario: {
      assetSizeBytes: scenario.assetSizeBytes,
      interruptedAfterBytes: scenario.interruptedAfterBytes,
      authoritativeOffsetAfterRestart: scenario.offsetAfterRestart.bytes,
      resumedFromByte: scenario.resumedFromByte,
      finalReceivedBytes: scenario.finalReceivedBytes,
      finalAssetVerified: scenario.finalAssetVerified,
      processKilled: true,
      appRestarted: true,
      networkInterrupted: true,
      duplicateQuotaBytes: duplicateDelta(quotaDelta, scenario.assetSizeBytes),
      duplicateCatalogRows: duplicateDelta(catalogDelta, 1),
    },
  };

  return {
    evidence,
    provesAcceptance: evidenceProvesPhysicalResumableAcceptance(evidence),
  };
}

/**
 * Controlled append path for real-device acceptance tooling. Failed observed
 * runs may still be recorded, but only evidence satisfying the independent
 * acceptance predicate can ever grant release readiness.
 */
export class PhysicalResumableAcceptanceCaptureWorkflow {
  constructor(private readonly store: PhysicalResumableAcceptanceEvidenceStore) {}

  async appendObservedRun(observation: PhysicalResumableObservedRun): Promise<PhysicalResumableCapturedEvidence> {
    const captured = derivePhysicalResumableEvidenceFromObservedRun(observation);
    await this.store.append(captured.evidence);
    return captured;
  }
}
