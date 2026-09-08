import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { ResumableFinalizeLedger } from './resumableFinalizeLedger.js';
import { ResumableMediaIngestStore, type ResumableMediaSession } from './resumableMediaIngest.js';
import {
  createResumableMediaIngestLifecycle,
  type ResumableIngestCommitInput,
  type ResumableIngestPrincipal,
  type ResumableQuotaReservationHooks,
} from './resumableMediaIngestLifecycle.js';
import {
  createResumableMediaIngestHttpHandler,
  type ResumableAcceptanceHttpIngestion,
} from './resumableMediaIngestHttp.js';

export type ResumableAcceptanceAuthorityRecorder = {
  sessionCreated(principal: ResumableIngestPrincipal, session: ResumableMediaSession): Promise<void>;
  statusObserved(principal: ResumableIngestPrincipal, session: ResumableMediaSession): Promise<void>;
  finalized(
    principal: ResumableIngestPrincipal,
    session: ResumableMediaSession,
    result: { state?: 'COMMITTED' | 'ALREADY_RECEIVED' },
  ): Promise<void>;
};

export type ResumableMediaReceiverRuntimeOptions<T> = {
  rootDir: string;
  authorize(req: IncomingMessage): Promise<ResumableIngestPrincipal>;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  commit(input: ResumableIngestCommitInput): Promise<T>;
  quota: ResumableQuotaReservationHooks;
  coordinator?: ReturnType<typeof createMediaIngestCommitCoordinator>;
  acceptanceIngestion?: ResumableAcceptanceHttpIngestion;
  acceptanceAuthority?: ResumableAcceptanceAuthorityRecorder;
  maxChunkBytes?: number;
  maxJsonBytes?: number;
  sessionTtlMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
  onCleanupError?: (error: unknown) => void;
  onAcceptanceAuthorityError?: (error: unknown) => void;
};

export type ResumableMediaReceiverRuntime = {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  cleanupExpired(): Promise<number>;
  startCleanup(): void;
  stopCleanup(): void;
};

const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

function positiveSafeInteger(value: number | undefined, fallback: number, code: string) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) throw new Error(code);
  return candidate;
}

/**
 * Production-shaped composition for the authenticated resumable media receiver.
 *
 * The caller owns application-specific authorization and final media commit logic.
 * This runtime owns durable upload-session state, authoritative byte offsets,
 * durable media-finalize ownership, quota-reservation lifecycle, HTTP routing and
 * periodic expired-session cleanup. Optional acceptance authority observation is
 * best-effort for normal ingest: evidence persistence failures can block physical
 * acceptance, but must never make an otherwise valid media upload fail.
 */
export function createResumableMediaReceiverRuntime<T>(options: ResumableMediaReceiverRuntimeOptions<T>): ResumableMediaReceiverRuntime {
  const cleanupIntervalMs = positiveSafeInteger(
    options.cleanupIntervalMs,
    DEFAULT_CLEANUP_INTERVAL_MS,
    'INVALID_RESUMABLE_CLEANUP_INTERVAL_MS',
  );
  const maxChunkBytes = options.maxChunkBytes;
  if (maxChunkBytes !== undefined && (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0)) {
    throw new Error('INVALID_RESUMABLE_MAX_CHUNK_BYTES');
  }

  const store = new ResumableMediaIngestStore({
    rootDir: options.rootDir,
    defaultTtlMs: options.sessionTtlMs,
    maxChunkBytes,
    now: options.now,
  });
  const finalizeLedger = new ResumableFinalizeLedger({
    rootDir: path.join(options.rootDir, 'finalize-ledger'),
    now: options.now,
  });
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    finalizeLedger,
    coordinator: options.coordinator,
    exists: options.exists,
    commit: options.commit,
    quota: options.quota,
  });

  async function observe(work: (() => Promise<void>) | undefined) {
    if (!work) return;
    try {
      await work();
    } catch (error) {
      options.onAcceptanceAuthorityError?.(error);
    }
  }

  const observedLifecycle = {
    ...lifecycle,
    async create(principal: ResumableIngestPrincipal, input: Parameters<typeof lifecycle.create>[1]) {
      const session = await lifecycle.create(principal, input);
      await observe(options.acceptanceAuthority
        ? () => options.acceptanceAuthority!.sessionCreated(principal, session)
        : undefined);
      return session;
    },
    async status(principal: ResumableIngestPrincipal, sessionId: string) {
      const session = await lifecycle.status(principal, sessionId);
      await observe(options.acceptanceAuthority
        ? () => options.acceptanceAuthority!.statusObserved(principal, session)
        : undefined);
      return session;
    },
    async finalize(principal: ResumableIngestPrincipal, input: Parameters<typeof lifecycle.finalize>[1]) {
      const session = await lifecycle.status(principal, input.sessionId);
      const result = await lifecycle.finalize(principal, input);
      await observe(options.acceptanceAuthority
        ? () => options.acceptanceAuthority!.finalized(principal, session, result)
        : undefined);
      return result;
    },
  };

  const handle = createResumableMediaIngestHttpHandler({
    authorize: options.authorize,
    lifecycle: observedLifecycle,
    acceptanceIngestion: options.acceptanceIngestion,
    maxChunkBytes,
    maxJsonBytes: options.maxJsonBytes,
  });

  let cleanupTimer: NodeJS.Timeout | null = null;
  let cleanupInFlight: Promise<number> | null = null;

  async function cleanupExpired() {
    if (cleanupInFlight) return cleanupInFlight;
    cleanupInFlight = lifecycle.cleanupExpired();
    try {
      return await cleanupInFlight;
    } finally {
      cleanupInFlight = null;
    }
  }

  function scheduleCleanup() {
    void cleanupExpired().catch(error => options.onCleanupError?.(error));
  }

  function startCleanup() {
    if (cleanupTimer) return;
    scheduleCleanup();
    cleanupTimer = setInterval(scheduleCleanup, cleanupIntervalMs);
    cleanupTimer.unref?.();
  }

  function stopCleanup() {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  return { handle, cleanupExpired, startCleanup, stopCleanup };
}