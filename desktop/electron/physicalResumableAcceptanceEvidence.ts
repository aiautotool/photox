export type PhysicalResumablePlatform = 'ios' | 'android';

export type PhysicalResumableAcceptanceEvidence = {
  version: 1;
  evidenceId: string;
  recordedAt: string;
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
    interruptedAfterBytes: number;
    authoritativeOffsetAfterRestart: number;
    resumedFromByte: number;
    finalReceivedBytes: number;
    finalAssetVerified: boolean;
    processKilled: boolean;
    appRestarted: boolean;
    networkInterrupted: boolean;
    duplicateQuotaBytes: number;
    duplicateCatalogRows: number;
  };
};

export type PhysicalResumableAcceptancePolicy = {
  releaseCommitSha: string;
  requiredPlatforms?: readonly PhysicalResumablePlatform[];
};

export type PhysicalResumableAcceptanceEvaluation = {
  accepted: boolean;
  releaseCommitSha: string;
  requiredPlatforms: PhysicalResumablePlatform[];
  acceptedPlatforms: PhysicalResumablePlatform[];
  blockers: string[];
  evidenceIds: string[];
};

const DEFAULT_REQUIRED_PLATFORMS: readonly PhysicalResumablePlatform[] = ['ios', 'android'];

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return nonNegativeSafeInteger(value) && value > 0;
}

function validIsoDate(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function parsePhysicalResumableAcceptanceEvidence(value: unknown): PhysicalResumableAcceptanceEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !nonEmpty(input.evidenceId) || !validIsoDate(input.recordedAt)) return undefined;

  const release = input.release as Record<string, unknown> | undefined;
  const device = input.device as Record<string, unknown> | undefined;
  const scenario = input.scenario as Record<string, unknown> | undefined;
  if (!release || !device || !scenario) return undefined;
  if (!nonEmpty(release.appVersion) || !nonEmpty(release.buildNumber) || !nonEmpty(release.commitSha)) return undefined;
  if (device.platform !== 'ios' && device.platform !== 'android') return undefined;
  if (!nonEmpty(device.model) || !nonEmpty(device.osVersion)) return undefined;

  const integerFields = [
    scenario.assetSizeBytes,
    scenario.interruptedAfterBytes,
    scenario.authoritativeOffsetAfterRestart,
    scenario.resumedFromByte,
    scenario.finalReceivedBytes,
    scenario.duplicateQuotaBytes,
    scenario.duplicateCatalogRows,
  ];
  if (!integerFields.every(nonNegativeSafeInteger) || !positiveSafeInteger(scenario.assetSizeBytes)) return undefined;
  const booleanFields = [
    scenario.finalAssetVerified,
    scenario.processKilled,
    scenario.appRestarted,
    scenario.networkInterrupted,
  ];
  if (!booleanFields.every((item) => typeof item === 'boolean')) return undefined;

  return value as PhysicalResumableAcceptanceEvidence;
}

export function evidenceProvesPhysicalResumableAcceptance(evidence: PhysicalResumableAcceptanceEvidence): boolean {
  const { scenario } = evidence;
  return scenario.networkInterrupted
    && scenario.processKilled
    && scenario.appRestarted
    && scenario.interruptedAfterBytes > 0
    && scenario.interruptedAfterBytes < scenario.assetSizeBytes
    && scenario.authoritativeOffsetAfterRestart === scenario.interruptedAfterBytes
    && scenario.resumedFromByte === scenario.authoritativeOffsetAfterRestart
    && scenario.finalReceivedBytes === scenario.assetSizeBytes
    && scenario.finalAssetVerified
    && scenario.duplicateQuotaBytes === 0
    && scenario.duplicateCatalogRows === 0;
}

/**
 * Physical-device acceptance is evidence-derived only. There is deliberately
 * no mutable "accepted" flag: every accepted platform must provide a valid
 * record for the exact release commit being evaluated.
 */
export function evaluatePhysicalResumableAcceptance(
  evidenceValues: readonly unknown[],
  policy: PhysicalResumableAcceptancePolicy,
): PhysicalResumableAcceptanceEvaluation {
  const requiredPlatforms = [...new Set(policy.requiredPlatforms ?? DEFAULT_REQUIRED_PLATFORMS)];
  const validEvidence = evidenceValues
    .map(parsePhysicalResumableAcceptanceEvidence)
    .filter((item): item is PhysicalResumableAcceptanceEvidence => item !== undefined)
    .filter((item) => item.release.commitSha === policy.releaseCommitSha)
    .filter(evidenceProvesPhysicalResumableAcceptance);

  const acceptedPlatforms = requiredPlatforms.filter((platform) => validEvidence.some((item) => item.device.platform === platform));
  const blockers = requiredPlatforms
    .filter((platform) => !acceptedPlatforms.includes(platform))
    .map((platform) => `PHYSICAL_RESUMABLE_EVIDENCE_MISSING_${platform.toUpperCase()}`);

  return {
    accepted: blockers.length === 0,
    releaseCommitSha: policy.releaseCommitSha,
    requiredPlatforms,
    acceptedPlatforms,
    blockers,
    evidenceIds: validEvidence.map((item) => item.evidenceId),
  };
}
