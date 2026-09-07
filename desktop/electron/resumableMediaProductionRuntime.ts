import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { createResumableMediaProductionCommit, type ResumableCommittedMediaRow, type ResumableMediaProductionCommitResult } from './resumableMediaProductionCommit.js';
import { createResumableMediaReceiverRuntime, type ResumableMediaReceiverRuntime } from './resumableMediaReceiverRuntime.js';
import { createWorkspaceResumableQuotaHooks } from './resumableQuotaHooks.js';

type WorkspaceQuotaRepository = Parameters<typeof createWorkspaceResumableQuotaHooks>[0];
type SharedIngestCoordinator = ReturnType<typeof createMediaIngestCommitCoordinator>;

export type ResumableMediaProductionRuntimeOptions = {
  rootDir: string;
  libraryRoot: string;
  incomingRoot: string;
  journalDir: string;
  authorizeRequest(req: IncomingMessage, required: ['media:write']): Promise<{ workspaceId?: string; deviceId?: string }>;
  workspaces: WorkspaceQuotaRepository;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  ingest(row: ResumableCommittedMediaRow): Promise<void>;
  onCommitted?(result: ResumableMediaProductionCommitResult): Promise<void> | void;
  coordinator: SharedIngestCoordinator;
  maxChunkBytes?: number;
  maxJsonBytes?: number;
  sessionTtlMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
  onCleanupError?(error: unknown): void;
  onJournalCleanupError?(error: unknown): void;
  onPostCommitError?(error: unknown): void;
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
 * The durable upload root is forced under the managed incoming root because the
 * ingest recovery journal intentionally rejects part files outside that trust
 * boundary. Callers may still provide a nested root explicitly; an unsafe root
 * is normalized to `<incomingRoot>/resumable` instead of weakening recovery.
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

  return createResumableMediaReceiverRuntime({
    rootDir: managedReceiverRoot(options.rootDir, options.incomingRoot),
    authorize: async req => {
      const principal = await options.authorizeRequest(req, ['media:write']);
      return {
        workspaceId: requiredPrincipal(principal.workspaceId, 'WORKSPACE_SCOPE_REQUIRED'),
        deviceId: requiredPrincipal(principal.deviceId, 'DEVICE_SCOPE_REQUIRED'),
      };
    },
    exists: options.exists,
    commit,
    quota: createWorkspaceResumableQuotaHooks(options.workspaces),
    coordinator: options.coordinator,
    maxChunkBytes: options.maxChunkBytes,
    maxJsonBytes: options.maxJsonBytes,
    sessionTtlMs: options.sessionTtlMs,
    cleanupIntervalMs: options.cleanupIntervalMs,
    now: options.now,
    onCleanupError: options.onCleanupError,
  });
}