import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import type { ResumableIngestCommitInput } from './resumableMediaIngestLifecycle.js';
import { createMediaIngestRecoveryJournal } from './mediaStartupRecovery.js';

export type ResumableCommittedMediaRow = {
  workspaceId: string;
  key: string;
  assetId: string;
  deviceId: string;
  filename: string;
  path: string;
  size: number;
  createdAt: number;
  receivedAt: string;
  sha256: string;
  mimeType: string;
  mediaType: 'photo' | 'video';
  videoProcessing?: 'queued';
  cloudReplicas: unknown[];
};

export type ResumableMediaProductionCommitResult = {
  row: ResumableCommittedMediaRow;
  target: string;
};

export type ResumableMediaProductionCommitOptions = {
  libraryRoot: string;
  incomingRoot: string;
  journalDir: string;
  ingest(row: ResumableCommittedMediaRow): Promise<void>;
  onCommitted?(result: ResumableMediaProductionCommitResult): Promise<void> | void;
  onJournalCleanupError?(error: unknown): void;
  onPostCommitError?(error: unknown): void;
  now?: () => number;
};

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '_').slice(0, 220) || `media-${Date.now()}`;
}

async function hashFile(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function syncFile(filePath: string) {
  const handle = await fs.open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function usableTimestamp(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? value : fallback;
}

/**
 * Final media handoff for a verified resumable upload.
 *
 * The upload part is intentionally copied, never renamed or deleted here. The
 * resumable lifecycle owns that part until quota commit and session removal are
 * complete. Keeping the authoritative part intact makes a finalize retry
 * possible when a downstream quota/catalog step fails after bytes were already
 * accepted by the server.
 */
export function createResumableMediaProductionCommit(options: ResumableMediaProductionCommitOptions) {
  const journal = createMediaIngestRecoveryJournal({
    journalDir: options.journalDir,
    libraryRoot: options.libraryRoot,
    incomingRoot: options.incomingRoot,
  });
  const now = options.now ?? Date.now;

  return async function commit(input: ResumableIngestCommitInput): Promise<ResumableMediaProductionCommitResult> {
    const filename = safeFilename(input.session.filename);
    const createdAt = usableTimestamp(input.session.createdAt, now());
    const date = new Date(createdAt);
    const folder = path.join(
      options.libraryRoot,
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
    );
    await fs.mkdir(folder, { recursive: true });

    const parsed = path.parse(filename);
    const uniqueSuffix = crypto
      .createHash('sha256')
      .update(`${input.workspaceId}\0${input.key}\0${crypto.randomUUID()}`)
      .digest('hex')
      .slice(0, 16);
    const target = path.join(folder, `${parsed.name}-${uniqueSuffix}${parsed.ext}`);
    const recovery = await journal.begin({
      workspaceId: input.workspaceId,
      key: input.key,
      tmpPath: input.partPath,
      targetPath: target,
    });

    let catalogCommitted = false;
    try {
      await fs.copyFile(input.partPath, target, constants.COPYFILE_EXCL);
      await syncFile(target);
      const stat = await fs.stat(target);
      if (stat.size !== input.session.expectedBytes) {
        throw new Error(`MEDIA_SIZE_MISMATCH:${input.session.expectedBytes}:${stat.size}`);
      }
      const targetSha256 = await hashFile(target);
      if (targetSha256 !== input.sha256) throw new Error('MEDIA_COPY_SHA256_MISMATCH');

      const row: ResumableCommittedMediaRow = {
        workspaceId: input.workspaceId,
        key: input.key,
        assetId: input.session.assetId,
        deviceId: input.session.deviceId,
        filename,
        path: target,
        size: stat.size,
        createdAt,
        receivedAt: new Date(now()).toISOString(),
        sha256: input.sha256,
        mimeType: input.session.mimeType,
        mediaType: input.session.mediaType,
        videoProcessing: input.session.mediaType === 'video' ? 'queued' : undefined,
        cloudReplicas: [],
      };
      await options.ingest(row);
      catalogCommitted = true;

      try {
        await journal.complete(recovery.journalId);
      } catch (error) {
        // Once the catalog row is authoritative, removing the target would make
        // the catalog point at missing bytes. Leave the journal for startup
        // recovery to recognize the committed row and clean it safely.
        options.onJournalCleanupError?.(error);
      }

      const result = { row, target };
      if (options.onCommitted) {
        try {
          await options.onCommitted(result);
        } catch (error) {
          // Video/cloud post-processing is retryable work and must not roll back
          // a media row whose local bytes and catalog entry are already durable.
          options.onPostCommitError?.(error);
        }
      }
      return result;
    } catch (error) {
      if (!catalogCommitted) {
        await fs.rm(target, { force: true }).catch(() => undefined);
        await journal.complete(recovery.journalId).catch(() => undefined);
      }
      throw error;
    }
  };
}
