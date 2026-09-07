import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ResumableFinalizeRecord = {
  version: 1;
  sessionId: string;
  workspaceId: string;
  deviceId: string;
  reservationId?: string;
  expectedBytes: number;
  key: string;
  sha256: string;
  committedAtIso: string;
};

export type ResumableFinalizeLedgerOptions = {
  rootDir: string;
  now?: () => number;
};

function identity(value: string, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 512) throw new Error(code);
  return normalized;
}

function sha256(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('UPLOAD_FINALIZE_SHA256_INVALID');
  return normalized;
}

function isRecord(value: unknown): value is ResumableFinalizeRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.version === 1
    && typeof row.sessionId === 'string'
    && typeof row.workspaceId === 'string'
    && typeof row.deviceId === 'string'
    && (row.reservationId === undefined || typeof row.reservationId === 'string')
    && Number.isSafeInteger(row.expectedBytes)
    && Number(row.expectedBytes) > 0
    && typeof row.key === 'string'
    && typeof row.sha256 === 'string'
    && typeof row.committedAtIso === 'string';
}

async function atomicWrite(filePath: string, value: ResumableFinalizeRecord) {
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, filePath);
}

export class ResumableFinalizeLedger {
  private readonly rootDir: string;
  private readonly now: () => number;

  constructor(options: ResumableFinalizeLedgerOptions) {
    this.rootDir = options.rootDir;
    this.now = options.now ?? Date.now;
  }

  private filePath(sessionId: string) {
    return path.join(this.rootDir, `${identity(sessionId, 'UPLOAD_SESSION_ID_REQUIRED')}.finalize.json`);
  }

  private async ensureRoot() {
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async get(sessionId: string, binding?: { workspaceId: string; deviceId: string }): Promise<ResumableFinalizeRecord | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.filePath(sessionId), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error('UPLOAD_FINALIZE_LEDGER_INVALID');
    }
    if (!isRecord(parsed) || parsed.sessionId !== sessionId) throw new Error('UPLOAD_FINALIZE_LEDGER_INVALID');
    if (binding && (parsed.workspaceId !== binding.workspaceId || parsed.deviceId !== binding.deviceId)) {
      throw new Error('UPLOAD_FINALIZE_BINDING_MISMATCH');
    }
    return parsed;
  }

  async markCommitted(input: Omit<ResumableFinalizeRecord, 'version' | 'committedAtIso'>): Promise<ResumableFinalizeRecord> {
    await this.ensureRoot();
    const record: ResumableFinalizeRecord = {
      version: 1,
      sessionId: identity(input.sessionId, 'UPLOAD_SESSION_ID_REQUIRED'),
      workspaceId: identity(input.workspaceId, 'WORKSPACE_SCOPE_REQUIRED'),
      deviceId: identity(input.deviceId, 'DEVICE_SCOPE_REQUIRED'),
      reservationId: input.reservationId ? identity(input.reservationId, 'UPLOAD_QUOTA_RESERVATION_INVALID') : undefined,
      expectedBytes: input.expectedBytes,
      key: identity(input.key, 'UPLOAD_FINALIZE_KEY_INVALID'),
      sha256: sha256(input.sha256),
      committedAtIso: new Date(this.now()).toISOString(),
    };
    if (!Number.isSafeInteger(record.expectedBytes) || record.expectedBytes <= 0) throw new Error('UPLOAD_FINALIZE_EXPECTED_BYTES_INVALID');

    const existing = await this.get(record.sessionId);
    if (existing) {
      if (existing.workspaceId !== record.workspaceId
        || existing.deviceId !== record.deviceId
        || existing.reservationId !== record.reservationId
        || existing.expectedBytes !== record.expectedBytes
        || existing.key !== record.key
        || existing.sha256 !== record.sha256) {
        throw new Error('UPLOAD_FINALIZE_LEDGER_CONFLICT');
      }
      return existing;
    }
    await atomicWrite(this.filePath(record.sessionId), record);
    return record;
  }

  async remove(sessionId: string) {
    await fs.rm(this.filePath(sessionId), { force: true });
  }
}
