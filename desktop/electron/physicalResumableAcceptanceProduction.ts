import fs from 'node:fs/promises';
import path from 'node:path';
import {
  evaluatePhysicalResumableAcceptance,
  type PhysicalResumableAcceptanceEvaluation,
} from './physicalResumableAcceptanceEvidence.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';

export type PhysicalResumableAcceptanceProductionDiagnostics = {
  initialized: boolean;
  accepted: boolean;
  releaseCommitSha?: string;
  requiredPlatforms: string[];
  acceptedPlatforms: string[];
  blockers: string[];
  evidenceCount: number;
  persistenceHealthy: boolean;
  captureMode: 'disabled' | 'real-device' | 'invalid';
  captureEnabled: boolean;
  serverAuthorityLedgerInitialized: boolean;
  serverAuthorityLedgerHealthy: boolean;
  serverAuthorityRecordCount: number;
  captureBlockers: string[];
};

type CaptureDiagnostics = Pick<
  PhysicalResumableAcceptanceProductionDiagnostics,
  'captureMode' | 'captureEnabled' | 'serverAuthorityLedgerInitialized' | 'serverAuthorityLedgerHealthy' | 'serverAuthorityRecordCount' | 'captureBlockers'
>;

const disabledCaptureDiagnostics: CaptureDiagnostics = {
  captureMode: 'disabled',
  captureEnabled: false,
  serverAuthorityLedgerInitialized: false,
  serverAuthorityLedgerHealthy: true,
  serverAuthorityRecordCount: 0,
  captureBlockers: [],
};

let diagnostics: PhysicalResumableAcceptanceProductionDiagnostics = {
  initialized: false,
  accepted: false,
  requiredPlatforms: ['ios', 'android'],
  acceptedPlatforms: [],
  blockers: ['PHYSICAL_RESUMABLE_EVIDENCE_NOT_INITIALIZED'],
  evidenceCount: 0,
  persistenceHealthy: false,
  ...disabledCaptureDiagnostics,
};
let initializing: Promise<void> | null = null;

function releaseCommitShaFromEnvironment(): string | undefined {
  const value = process.env.PHOTOX_RELEASE_COMMIT_SHA?.trim();
  return value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined;
}

function validAuthorityRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const nonEmpty = (input: unknown) => typeof input === 'string' && input.trim().length > 0;
  return row.version === 1
    && nonEmpty(row.workspaceId)
    && nonEmpty(row.deviceId)
    && nonEmpty(row.assetId)
    && nonEmpty(row.sessionId)
    && typeof row.expectedBytes === 'number'
    && Number.isSafeInteger(row.expectedBytes)
    && row.expectedBytes > 0
    && Array.isArray(row.status);
}

async function captureDiagnosticsFromEnvironment(stateDirectory: string): Promise<CaptureDiagnostics> {
  const rawMode = String(process.env.PHOTOX_PHYSICAL_RESUMABLE_ACCEPTANCE_MODE || '').trim().toLowerCase();
  if (!rawMode) return { ...disabledCaptureDiagnostics, captureBlockers: [] };
  if (rawMode !== 'real-device') {
    return {
      captureMode: 'invalid',
      captureEnabled: false,
      serverAuthorityLedgerInitialized: false,
      serverAuthorityLedgerHealthy: false,
      serverAuthorityRecordCount: 0,
      captureBlockers: ['PHYSICAL_RESUMABLE_ACCEPTANCE_MODE_INVALID'],
    };
  }

  const filePath = path.join(stateDirectory, 'physical-resumable-server-authority.json');
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as { version?: unknown; records?: unknown };
    if (!value || value.version !== 1 || !Array.isArray(value.records) || !value.records.every(validAuthorityRecord)) {
      throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_INVALID');
    }
    return {
      captureMode: 'real-device',
      captureEnabled: true,
      serverAuthorityLedgerInitialized: true,
      serverAuthorityLedgerHealthy: true,
      serverAuthorityRecordCount: value.records.length,
      captureBlockers: [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {
        captureMode: 'real-device',
        captureEnabled: true,
        serverAuthorityLedgerInitialized: false,
        serverAuthorityLedgerHealthy: true,
        serverAuthorityRecordCount: 0,
        captureBlockers: ['PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_NOT_INITIALIZED'],
      };
    }
    console.error('PhotoX physical resumable server authority ledger inspection failed', error);
    return {
      captureMode: 'real-device',
      captureEnabled: true,
      serverAuthorityLedgerInitialized: true,
      serverAuthorityLedgerHealthy: false,
      serverAuthorityRecordCount: 0,
      captureBlockers: ['PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_UNHEALTHY'],
    };
  }
}

function fromEvaluation(
  evaluation: PhysicalResumableAcceptanceEvaluation,
  evidenceCount: number,
  capture: CaptureDiagnostics,
): PhysicalResumableAcceptanceProductionDiagnostics {
  return {
    initialized: true,
    accepted: evaluation.accepted,
    releaseCommitSha: evaluation.releaseCommitSha,
    requiredPlatforms: evaluation.requiredPlatforms,
    acceptedPlatforms: evaluation.acceptedPlatforms,
    blockers: evaluation.blockers,
    evidenceCount,
    persistenceHealthy: true,
    ...capture,
  };
}

/**
 * Loads immutable physical-device resumable evidence for the exact packaged
 * release commit. A missing/invalid release SHA or unreadable ledger always
 * fails closed; there is deliberately no mutable acceptance toggle.
 *
 * The same read-only snapshot also reports whether controlled real-device
 * capture is enabled and whether its independent server-authority ledger can be
 * parsed. It never exposes ledger paths, workspace/device/media identities, or
 * any mutable control.
 */
export async function initializePhysicalResumableAcceptance(
  stateDirectory: string,
  releaseCommitSha = releaseCommitShaFromEnvironment(),
): Promise<void> {
  if (diagnostics.initialized) return;
  if (initializing) return initializing;
  initializing = (async () => {
    const capture = await captureDiagnosticsFromEnvironment(stateDirectory);
    if (!releaseCommitSha || !/^[0-9a-f]{40}$/i.test(releaseCommitSha)) {
      diagnostics = {
        initialized: true,
        accepted: false,
        requiredPlatforms: ['ios', 'android'],
        acceptedPlatforms: [],
        blockers: ['PHYSICAL_RESUMABLE_RELEASE_COMMIT_SHA_MISSING'],
        evidenceCount: 0,
        persistenceHealthy: true,
        ...capture,
      };
      return;
    }

    const normalizedCommitSha = releaseCommitSha.toLowerCase();
    const store = new PhysicalResumableAcceptanceEvidenceStore(
      path.join(stateDirectory, 'physical-resumable-acceptance-evidence.json'),
    );
    try {
      const evidence = await store.load();
      diagnostics = fromEvaluation(
        evaluatePhysicalResumableAcceptance(evidence, { releaseCommitSha: normalizedCommitSha }),
        evidence.length,
        capture,
      );
    } catch (error) {
      console.error('PhotoX physical resumable acceptance evidence load failed', error);
      diagnostics = {
        initialized: true,
        accepted: false,
        releaseCommitSha: normalizedCommitSha,
        requiredPlatforms: ['ios', 'android'],
        acceptedPlatforms: [],
        blockers: ['PHYSICAL_RESUMABLE_EVIDENCE_STORE_UNHEALTHY'],
        evidenceCount: 0,
        persistenceHealthy: false,
        ...capture,
      };
    }
  })();
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

export function physicalResumableAcceptanceDiagnostics(): PhysicalResumableAcceptanceProductionDiagnostics {
  return {
    ...diagnostics,
    requiredPlatforms: [...diagnostics.requiredPlatforms],
    acceptedPlatforms: [...diagnostics.acceptedPlatforms],
    blockers: [...diagnostics.blockers],
    captureBlockers: [...diagnostics.captureBlockers],
  };
}

/** Test-only reset keeps production code evidence-derived and immutable. */
export function resetPhysicalResumableAcceptanceForTests(): void {
  diagnostics = {
    initialized: false,
    accepted: false,
    requiredPlatforms: ['ios', 'android'],
    acceptedPlatforms: [],
    blockers: ['PHYSICAL_RESUMABLE_EVIDENCE_NOT_INITIALIZED'],
    evidenceCount: 0,
    persistenceHealthy: false,
    ...disabledCaptureDiagnostics,
  };
  initializing = null;
}
