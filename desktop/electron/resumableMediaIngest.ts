import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ResumableMediaSession = {
  version: 1;
  sessionId: string;
  workspaceId: string;
  deviceId: string;
  assetId: string;
  filename: string;
  mimeType: string;
  mediaType: 'photo' | 'video';
  createdAt: number;
  expectedBytes: number;
  acknowledgedBytes: number;
  quotaReservationId?: string;
  createdAtIso: string;
  updatedAtIso: string;
  expiresAtIso: string;
};

export type CreateResumableMediaSessionInput = {
  workspaceId: string;
  deviceId: string;
  assetId: string;
  filename: string;
  mimeType: string;
  mediaType: 'photo' | 'video';
  createdAt: number;
  expectedBytes: number;
  quotaReservationId?: string;
  ttlMs?: number;
};

export type ResumableMediaIngestStoreOptions = {
  rootDir: string;
  now?: () => number;
  defaultTtlMs?: number;
  maxChunkBytes?: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CHUNK_BYTES = 8 * 1024 * 1024;

function assertIdentity(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) throw new Error(`INVALID_${field.toUpperCase()}`);
  return normalized;
}

function assertOptionalIdentity(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  return assertIdentity(value, field);
}

function assertPositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`INVALID_${field.toUpperCase()}`);
  return value;
}

function safeSessionId() {
  return `upload_${crypto.randomBytes(18).toString('base64url')}`;
}

async function atomicWriteJson(filePath: string, value: unknown) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const data = `${JSON.stringify(value)}\n`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, filePath);
}

function isSession(value: unknown): value is ResumableMediaSession {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.version === 1
    && typeof row.sessionId === 'string'
    && typeof row.workspaceId === 'string'
    && typeof row.deviceId === 'string'
    && typeof row.assetId === 'string'
    && typeof row.filename === 'string'
    && typeof row.mimeType === 'string'
    && (row.mediaType === 'photo' || row.mediaType === 'video')
    && typeof row.createdAt === 'number'
    && Number.isSafeInteger(row.expectedBytes)
    && Number(row.expectedBytes) > 0
    && Number.isSafeInteger(row.acknowledgedBytes)
    && Number(row.acknowledgedBytes) >= 0
    && Number(row.acknowledgedBytes) <= Number(row.expectedBytes)
    && (row.quotaReservationId === undefined || typeof row.quotaReservationId === 'string')
    && typeof row.createdAtIso === 'string'
    && typeof row.updatedAtIso === 'string'
    && typeof row.expiresAtIso === 'string';
}

export class ResumableMediaIngestStore {
  private readonly rootDir: string;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;
  private readonly maxChunkBytes: number;

  constructor(options: ResumableMediaIngestStoreOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? Date.now;
    this.defaultTtlMs = assertPositiveSafeInteger(options.defaultTtlMs ?? DEFAULT_TTL_MS, 'default_ttl_ms');
    this.maxChunkBytes = assertPositiveSafeInteger(options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES, 'max_chunk_bytes');
  }

  private metadataPath(sessionId: string) {
    return path.join(this.rootDir, `${assertIdentity(sessionId, 'session_id')}.json`);
  }

  private partPath(sessionId: string) {
    return path.join(this.rootDir, `${assertIdentity(sessionId, 'session_id')}.part`);
  }

  private async ensureRoot() {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  private async readSessionUnchecked(sessionId: string): Promise<ResumableMediaSession> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.metadataPath(sessionId), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('UPLOAD_SESSION_NOT_FOUND');
      throw new Error('UPLOAD_SESSION_METADATA_INVALID');
    }
    if (!isSession(parsed) || parsed.sessionId !== sessionId) throw new Error('UPLOAD_SESSION_METADATA_INVALID');
    const stat = await fs.stat(this.partPath(sessionId)).catch(() => null);
    if (!stat || stat.size !== parsed.acknowledgedBytes) throw new Error('UPLOAD_SESSION_OFFSET_CORRUPT');
    return parsed;
  }

  async create(input: CreateResumableMediaSessionInput): Promise<ResumableMediaSession> {
    await this.ensureRoot();
    const workspaceId = assertIdentity(input.workspaceId, 'workspace_id');
    const deviceId = assertIdentity(input.deviceId, 'device_id');
    const assetId = assertIdentity(input.assetId, 'asset_id');
    const filename = assertIdentity(input.filename, 'filename');
    const mimeType = assertIdentity(input.mimeType, 'mime_type');
    const expectedBytes = assertPositiveSafeInteger(input.expectedBytes, 'expected_bytes');
    const quotaReservationId = assertOptionalIdentity(input.quotaReservationId, 'quota_reservation_id');
    if (!Number.isFinite(input.createdAt)) throw new Error('INVALID_CREATED_AT');
    const ttlMs = assertPositiveSafeInteger(input.ttlMs ?? this.defaultTtlMs, 'ttl_ms');
    const now = this.now();
    const session: ResumableMediaSession = {
      version: 1,
      sessionId: safeSessionId(),
      workspaceId,
      deviceId,
      assetId,
      filename,
      mimeType,
      mediaType: input.mediaType,
      createdAt: input.createdAt,
      expectedBytes,
      acknowledgedBytes: 0,
      quotaReservationId,
      createdAtIso: new Date(now).toISOString(),
      updatedAtIso: new Date(now).toISOString(),
      expiresAtIso: new Date(now + ttlMs).toISOString(),
    };
    await fs.writeFile(this.partPath(session.sessionId), Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    try {
      await atomicWriteJson(this.metadataPath(session.sessionId), session);
    } catch (error) {
      await fs.rm(this.partPath(session.sessionId), { force: true }).catch(() => undefined);
      throw error;
    }
    return session;
  }

  async get(sessionId: string, binding?: { workspaceId: string; deviceId: string }): Promise<ResumableMediaSession> {
    const session = await this.readSessionUnchecked(sessionId);
    if (binding && (session.workspaceId !== binding.workspaceId || session.deviceId !== binding.deviceId)) {
      throw new Error('UPLOAD_SESSION_BINDING_MISMATCH');
    }
    if (Date.parse(session.expiresAtIso) <= this.now()) throw new Error('UPLOAD_SESSION_EXPIRED');
    return session;
  }

  async appendChunk(input: {
    sessionId: string;
    workspaceId: string;
    deviceId: string;
    offset: number;
    chunk: Uint8Array;
  }): Promise<ResumableMediaSession> {
    const session = await this.get(input.sessionId, { workspaceId: input.workspaceId, deviceId: input.deviceId });
    if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error('INVALID_UPLOAD_OFFSET');
    if (input.offset !== session.acknowledgedBytes) throw new Error(`UPLOAD_OFFSET_MISMATCH:${session.acknowledgedBytes}`);
    if (!(input.chunk instanceof Uint8Array) || input.chunk.byteLength <= 0) throw new Error('UPLOAD_CHUNK_REQUIRED');
    if (input.chunk.byteLength > this.maxChunkBytes) throw new Error('UPLOAD_CHUNK_TOO_LARGE');
    if (session.acknowledgedBytes + input.chunk.byteLength > session.expectedBytes) throw new Error('UPLOAD_EXCEEDS_EXPECTED_BYTES');

    const handle = await fs.open(this.partPath(session.sessionId), 'r+');
    try {
      const result = await handle.write(input.chunk, 0, input.chunk.byteLength, input.offset);
      if (result.bytesWritten !== input.chunk.byteLength) throw new Error('UPLOAD_CHUNK_SHORT_WRITE');
      await handle.sync();
    } finally {
      await handle.close();
    }

    const updated: ResumableMediaSession = {
      ...session,
      acknowledgedBytes: session.acknowledgedBytes + input.chunk.byteLength,
      updatedAtIso: new Date(this.now()).toISOString(),
    };
    try {
      await atomicWriteJson(this.metadataPath(session.sessionId), updated);
    } catch (error) {
      await fs.truncate(this.partPath(session.sessionId), session.acknowledgedBytes).catch(() => undefined);
      throw error;
    }
    return updated;
  }

  async requireComplete(sessionId: string, binding: { workspaceId: string; deviceId: string }): Promise<{ session: ResumableMediaSession; partPath: string }> {
    const session = await this.get(sessionId, binding);
    if (session.acknowledgedBytes !== session.expectedBytes) throw new Error(`UPLOAD_INCOMPLETE:${session.acknowledgedBytes}`);
    return { session, partPath: this.partPath(session.sessionId) };
  }

  async remove(sessionId: string): Promise<void> {
    const id = assertIdentity(sessionId, 'session_id');
    await Promise.all([
      fs.rm(this.metadataPath(id), { force: true }),
      fs.rm(this.partPath(id), { force: true }),
    ]);
  }

  async cleanupExpired(beforeRemove?: (session: ResumableMediaSession) => Promise<void>): Promise<number> {
    await this.ensureRoot();
    const names = await fs.readdir(this.rootDir);
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const sessionId = name.slice(0, -5);
      let session: ResumableMediaSession | undefined;
      try {
        session = await this.readSessionUnchecked(sessionId);
        if (Date.parse(session.expiresAtIso) > this.now()) continue;
      } catch (error) {
        if (error instanceof Error && error.message === 'UPLOAD_SESSION_OFFSET_CORRUPT') continue;
        if (error instanceof Error && error.message === 'UPLOAD_SESSION_METADATA_INVALID') continue;
      }
      if (session && beforeRemove) await beforeRemove(session);
      await this.remove(sessionId);
      removed += 1;
    }
    return removed;
  }
}
