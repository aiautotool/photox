import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { PhysicalResumableAcceptanceCaptureWorkflow } from './physicalResumableAcceptanceCapture.js';
import { PhysicalResumableAcceptanceEvidenceStore } from './physicalResumableAcceptanceEvidenceStore.js';
import { PhysicalResumableAcceptanceIngestion } from './physicalResumableAcceptanceIngestion.js';
import { PhysicalResumableServerAuthorityLedger } from './physicalResumableServerAuthority.js';
import { createResumableMediaProductionCommit, type ResumableCommittedMediaRow, type ResumableMediaProductionCommitResult } from './resumableMediaProductionCommit.js';
import { createResumableMediaReceiverRuntime, type ResumableMediaReceiverRuntime } from './resumableMediaReceiverRuntime.js';
import { createWorkspaceResumableQuotaHooks } from './resumableQuotaHooks.js';

type WorkspaceQuotaRepository = Parameters<typeof createWorkspaceResumableQuotaHooks>[0];
type SharedIngestCoordinator = ReturnType<typeof createMediaIngestCommitCoordinator>;

export type ResumablePhysicalAcceptanceOptions = {
  stateDirectory: string;
  counters(workspaceId: string): Promise<{ quotaBytes: number; catalogRows: number; observedAt: string }>;
};

export type ResumableMediaProductionRuntimeOptions = {
  rootDir: string;
  libraryRoot: string;
  incomingRoot: string;
  journalDir: string;
  authorizeRequest(req: IncomingMessage, required: ['media:write']): Promise<{ subject?: string; workspaceId?: string; deviceId?: string }>;
  workspaces: WorkspaceQuotaRepository;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  ingest(row: ResumableCommittedMediaRow): Promise<void>;
  onCommitted?(result: ResumableMediaProductionCommitResult): Promise<void> | void;
  coordinator: SharedIngestCoordinator;
  physicalAcceptance?: ResumablePhysicalAcceptanceOptions;
  maxChunkBytes?: number;
  maxJsonBytes?: number;
  sessionTtlMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
  onCleanupError?(error: unknown): void;
  onJournalCleanupError?(error: unknown): void;
  onPostCommitError?(error: unknown): void;
  onAcceptanceAuthorityError?(error: unknown): void;
};

function requiredPrincipal(value: string | undefined, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function managedReceiverRoot(rootDir: string, incomingRoot: string) {
  const candidate = path.resolve(rootDir);
  const incoming = path.resolve(incomingRoot);
  if (candidate === incoming || candidate.startsWith(`${incoming}${path.sep}`)) return candidate;
  return path.join(incoming, 'resumable');
}

/**
 * Wires the durable resumable protocol to PhotoX's production authorities.
 *
 * This deliberately contains no HTTP server of its own. The existing Desktop
 * receiver remains the single listener and delegates `/api/v1/media/uploads/*`
 * requests to the returned runtime. That keeps legacy whole-file uploads and
 * resumable uploads on the same process-wide ingest coordinator while both
 * protocols coexist during the mobile migration period.
 *
 * Physical acceptance capture is opt-in. When supplied it uses an independent
 * durable server ledger plus the existing append-only evidence ledger; mobile
 * can submit chronology/identity only and cannot provide authoritative offset,
 * quota, catalog or verification observations.
 */
export function createResumableMediaProductionRuntime(
  options: ResumableMediaProductionRuntimeOptions,
): ResumableMediaReceiverRuntime {
  const commit = createResumableMediaProductionCommit({
    libraryRoot: options.libraryRoot,
    incomingRoot: options.incomingRoot,
    journalDir: options.journalDir,
    ingest: options.ingest,
    onCommitted: options.onCommitted,
    onJournalCleanupError: options.onJournalCleanupError,
    onPostCommitError: options.onPostCommitError,
    now: options.now,
  });

  const authority = options.physicalAcceptance
    ? new PhysicalResumableServerAuthorityLedger(
        path.join(options.physicalAcceptance.stateDirectory, 'physical-resumable-server-authority.json'),
        { counters: options.physicalAcceptance.counters },
        options.now,
      )
    : undefined;
  const acceptanceIngestion = authority && options.physicalAcceptance
    ? new PhysicalResumableAcceptanceIngestion(
        authority,
        new PhysicalResumableAcceptanceCaptureWorkflow(
          new PhysicalResumableAcceptanceEvidenceStore(
            path.join(options.physicalAcceptance.stateDirectory, 'physical-resumable-acceptance-evidence.json'),
          ),
        ),
      )
    : undefined;

  return createResumableMediaReceiverRuntime({
    rootDir: managedReceiverRoot(options.rootDir, options.incomingRoot),
    authorize: async req => {
      const principal = await options.authorizeRequest(req, ['media:write']);
      return {
        actorUserId: requiredPrincipal(principal.subject, 'USER_SCOPE_REQUIRED'),
        workspaceId: requiredPrincipal(principal.workspaceId, 'WORKSPACE_SCOPE_REQUIRED'),
        deviceId: requiredPrincipal(principal.deviceId, 'DEVICE_SCOPE_REQUIRED'),
      };
    },
    exists: options.exists,
    commit,
    quota: createWorkspaceResumableQuotaHooks(options.workspaces),
    coordinator: options.coordinator,
    acceptanceAuthority: authority,
    acceptanceIngestion,
    maxChunkBytes: options.maxChunkBytes,
    maxJsonBytes: options.maxJsonBytes,
    sessionTtlMs: options.sessionTtlMs,
    cleanupIntervalMs: options.cleanupIntervalMs,
    now: options.now,
    onCleanupError: options.onCleanupError,
    onAcceptanceAuthorityError: options.onAcceptanceAuthorityError,
  });
}