import type { IncomingMessage, ServerResponse } from 'node:http';
import { ResumableMediaIngestStore } from './resumableMediaIngest.js';
import {
  createResumableMediaIngestLifecycle,
  type ResumableIngestCommitInput,
  type ResumableIngestPrincipal,
  type ResumableQuotaReservationHooks,
} from './resumableMediaIngestLifecycle.js';
import { createResumableMediaIngestHttpHandler } from './resumableMediaIngestHttp.js';

export type ResumableMediaReceiverRuntimeOptions<T> = {
  rootDir: string;
  authorize(req: IncomingMessage): Promise<ResumableIngestPrincipal>;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  commit(input: ResumableIngestCommitInput): Promise<T>;
  quota: ResumableQuotaReservationHooks;
  maxChunkBytes?: number;
  maxJsonBytes?: number;
  sessionTtlMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
  onCleanupError?: (error: unknown) => void;
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
 * quota-reservation lifecycle, HTTP routing and periodic expired-session cleanup.
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
  const lifecycle = createResumableMediaIngestLifecycle({
    store,
    exists: options.exists,
    commit: options.commit,
    quota: options.quota,
  });
  const handle = createResumableMediaIngestHttpHandler({
    authorize: options.authorize,
    lifecycle,
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
