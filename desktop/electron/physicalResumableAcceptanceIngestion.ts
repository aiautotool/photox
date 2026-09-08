import {
  PhysicalResumableAcceptanceCaptureWorkflow,
  type PhysicalResumableCapturedEvidence,
  type PhysicalResumableObservedRun,
} from './physicalResumableAcceptanceCapture.js';
import type { PhysicalResumablePlatform } from './physicalResumableAcceptanceEvidence.js';

export type MobilePhysicalResumableAcceptanceReport = {
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
  upload: {
    assetId: string;
    sessionId: string;
    assetSizeBytes: number;
  };
  scenario: {
    networkInterruptedAt: string;
    interruptedAfterBytes: number;
    processKilledAt: string;
    appRestartedAt: string;
    resumeStartedAt: string;
    resumedFromByte: number;
    completedAt: string;
  };
};

export type PhysicalResumableServerAuthoritySnapshot = {
  offsetAfterRestart: {
    bytes: number;
    observedAt: string;
  };
  finalReceivedBytes: number;
  finalAssetVerified: boolean;
  quotaBefore: {
    bytes: number;
    observedAt: string;
  };
  quotaAfter: {
    bytes: number;
    observedAt: string;
  };
  catalogBefore: {
    rows: number;
    observedAt: string;
  };
  catalogAfter: {
    rows: number;
    observedAt: string;
  };
};

export type PhysicalResumableServerAuthority = {
  observe(input: {
    workspaceId: string;
    deviceId: string;
    assetId: string;
    sessionId: string;
    runId: string;
  }): Promise<PhysicalResumableServerAuthoritySnapshot>;
};

const TOP_LEVEL_KEYS = ['version', 'runId', 'startedAt', 'release', 'device', 'upload', 'scenario'] as const;
const RELEASE_KEYS = ['appVersion', 'buildNumber', 'commitSha'] as const;
const DEVICE_KEYS = ['platform', 'model', 'osVersion'] as const;
const UPLOAD_KEYS = ['assetId', 'sessionId', 'assetSizeBytes'] as const;
const SCENARIO_KEYS = [
  'networkInterruptedAt',
  'interruptedAfterBytes',
  'processKilledAt',
  'appRestartedAt',
  'resumeStartedAt',
  'resumedFromByte',
  'completedAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: unknown, expected: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(code);
  }
}

/**
 * Fail-closed parser for the untrusted mobile acceptance artifact. In
 * particular the client is not allowed to submit server offset, quota,
 * catalog, verification, duplicate or authority/source fields. Those values
 * are populated exclusively from PhysicalResumableServerAuthority.
 */
export function validateMobilePhysicalResumableAcceptanceReport(
  input: unknown,
): MobilePhysicalResumableAcceptanceReport {
  assertExactKeys(input, TOP_LEVEL_KEYS, 'INVALID_MOBILE_RESUMABLE_ACCEPTANCE_REPORT');
  assertExactKeys(input.release, RELEASE_KEYS, 'INVALID_MOBILE_RESUMABLE_ACCEPTANCE_RELEASE');
  assertExactKeys(input.device, DEVICE_KEYS, 'INVALID_MOBILE_RESUMABLE_ACCEPTANCE_DEVICE');
  assertExactKeys(input.upload, UPLOAD_KEYS, 'INVALID_MOBILE_RESUMABLE_ACCEPTANCE_UPLOAD');
  assertExactKeys(input.scenario, SCENARIO_KEYS, 'INVALID_MOBILE_RESUMABLE_ACCEPTANCE_SCENARIO');
  return input as unknown as MobilePhysicalResumableAcceptanceReport;
}

export class PhysicalResumableAcceptanceIngestion {
  constructor(
    private readonly authority: PhysicalResumableServerAuthority,
    private readonly capture: PhysicalResumableAcceptanceCaptureWorkflow,
  ) {}

  async ingest(input: {
    workspaceId: string;
    deviceId: string;
    report: unknown;
  }): Promise<PhysicalResumableCapturedEvidence> {
    if (!input.workspaceId || !input.deviceId) {
      throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_AUTH_BINDING_REQUIRED');
    }
    const report = validateMobilePhysicalResumableAcceptanceReport(input.report);
    const authoritative = await this.authority.observe({
      workspaceId: input.workspaceId,
      deviceId: input.deviceId,
      assetId: report.upload.assetId,
      sessionId: report.upload.sessionId,
      runId: report.runId,
    });

    const observation: PhysicalResumableObservedRun = {
      version: 1,
      runId: report.runId,
      startedAt: report.startedAt,
      release: { ...report.release },
      device: { ...report.device },
      scenario: {
        assetSizeBytes: report.upload.assetSizeBytes,
        networkInterruptedAt: report.scenario.networkInterruptedAt,
        interruptedAfterBytes: report.scenario.interruptedAfterBytes,
        processKilledAt: report.scenario.processKilledAt,
        appRestartedAt: report.scenario.appRestartedAt,
        offsetAfterRestart: {
          source: 'server-authoritative',
          bytes: authoritative.offsetAfterRestart.bytes,
          observedAt: authoritative.offsetAfterRestart.observedAt,
        },
        resumeStartedAt: report.scenario.resumeStartedAt,
        resumedFromByte: report.scenario.resumedFromByte,
        completedAt: report.scenario.completedAt,
        finalReceivedBytes: authoritative.finalReceivedBytes,
        finalAssetVerified: authoritative.finalAssetVerified,
        quotaBefore: {
          source: 'workspace-authoritative',
          bytes: authoritative.quotaBefore.bytes,
          observedAt: authoritative.quotaBefore.observedAt,
        },
        quotaAfter: {
          source: 'workspace-authoritative',
          bytes: authoritative.quotaAfter.bytes,
          observedAt: authoritative.quotaAfter.observedAt,
        },
        catalogBefore: {
          source: 'catalog-authoritative',
          rows: authoritative.catalogBefore.rows,
          observedAt: authoritative.catalogBefore.observedAt,
        },
        catalogAfter: {
          source: 'catalog-authoritative',
          rows: authoritative.catalogAfter.rows,
          observedAt: authoritative.catalogAfter.observedAt,
        },
      },
    };

    return this.capture.appendObservedRun(observation);
  }
}
