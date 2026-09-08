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
};

let diagnostics: PhysicalResumableAcceptanceProductionDiagnostics = {
  initialized: false,
  accepted: false,
  requiredPlatforms: ['ios', 'android'],
  acceptedPlatforms: [],
  blockers: ['PHYSICAL_RESUMABLE_EVIDENCE_NOT_INITIALIZED'],
  evidenceCount: 0,
  persistenceHealthy: false,
};
let initializing: Promise<void> | null = null;

function releaseCommitShaFromEnvironment(): string | undefined {
  const value = process.env.PHOTOX_RELEASE_COMMIT_SHA?.trim();
  return value && /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined;
}

function fromEvaluation(
  evaluation: PhysicalResumableAcceptanceEvaluation,
  evidenceCount: number,
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
  };
}

/**
 * Loads immutable physical-device resumable evidence for the exact packaged
 * release commit. A missing/invalid release SHA or unreadable ledger always
 * fails closed; there is deliberately no mutable acceptance toggle.
 */
export async function initializePhysicalResumableAcceptance(
  stateDirectory: string,
  releaseCommitSha = releaseCommitShaFromEnvironment(),
): Promise<void> {
  if (diagnostics.initialized) return;
  if (initializing) return initializing;
  initializing = (async () => {
    if (!releaseCommitSha || !/^[0-9a-f]{40}$/i.test(releaseCommitSha)) {
      diagnostics = {
        initialized: true,
        accepted: false,
        requiredPlatforms: ['ios', 'android'],
        acceptedPlatforms: [],
        blockers: ['PHYSICAL_RESUMABLE_RELEASE_COMMIT_SHA_MISSING'],
        evidenceCount: 0,
        persistenceHealthy: true,
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
  };
  initializing = null;
}
