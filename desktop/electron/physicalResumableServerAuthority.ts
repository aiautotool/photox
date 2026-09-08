import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PhysicalResumableServerAuthority,
  PhysicalResumableServerAuthoritySnapshot,
} from './physicalResumableAcceptanceIngestion.js';
import type { ResumableIngestPrincipal } from './resumableMediaIngestLifecycle.js';
import type { ResumableMediaSession } from './resumableMediaIngest.js';

export type PhysicalResumableAuthorityCounters = {
  quotaBytes: number;
  catalogRows: number;
  observedAt: string;
};

export type PhysicalResumableAuthoritySources = {
  counters(workspaceId: string, session: ResumableMediaSession): Promise<PhysicalResumableAuthorityCounters>;
};

export type PhysicalResumableAuthorityFinalizeResult = {
  state?: 'COMMITTED' | 'ALREADY_RECEIVED';
};

type OffsetObservation = { bytes: number; observedAt: string };
type AuthorityRecord = {
  version: 1;
  workspaceId: string;
  deviceId: string;
  assetId: string;
  sessionId: string;
  expectedBytes: number;
  createdAt: string;
  quotaBefore: { bytes: number; observedAt: string };
  catalogBefore: { rows: number; observedAt: string };
  status: OffsetObservation[];
  final?: {
    receivedBytes: number;
    assetVerified: boolean;
    quotaAfter: { bytes: number; observedAt: string };
    catalogAfter: { rows: number; observedAt: string };
    observedAt: string;
  };
};

type AuthorityLedger = { version: 1; records: AuthorityRecord[] };

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validIso(value: unknown): value is string {
  return nonEmpty(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function parseRecord(value: unknown): AuthorityRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as AuthorityRecord;
  if (row.version !== 1 || !nonEmpty(row.workspaceId) || !nonEmpty(row.deviceId)
    || !nonEmpty(row.assetId) || !nonEmpty(row.sessionId) || !nonNegativeSafeInteger(row.expectedBytes)
    || row.expectedBytes <= 0 || !validIso(row.createdAt)) return undefined;
  if (!row.quotaBefore || !nonNegativeSafeInteger(row.quotaBefore.bytes) || !validIso(row.quotaBefore.observedAt)) return undefined;
  if (!row.catalogBefore || !nonNegativeSafeInteger(row.catalogBefore.rows) || !validIso(row.catalogBefore.observedAt)) return undefined;
  if (!Array.isArray(row.status) || row.status.some(item => !nonNegativeSafeInteger(item?.bytes) || !validIso(item?.observedAt))) return undefined;
  if (row.final) {
    if (!nonNegativeSafeInteger(row.final.receivedBytes) || typeof row.final.assetVerified !== 'boolean'
      || !row.final.quotaAfter || !nonNegativeSafeInteger(row.final.quotaAfter.bytes) || !validIso(row.final.quotaAfter.observedAt)
      || !row.final.catalogAfter || !nonNegativeSafeInteger(row.final.catalogAfter.rows) || !validIso(row.final.catalogAfter.observedAt)
      || !validIso(row.final.observedAt)) return undefined;
  }
  return row;
}

function parseLedger(value: unknown): AuthorityLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_INVALID');
  const input = value as { version?: unknown; records?: unknown };
  if (input.version !== 1 || !Array.isArray(input.records)) throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_INVALID');
  const records = input.records.map(parseRecord);
  if (records.some(item => !item)) throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_LEDGER_INVALID');
  return { version: 1, records: records as AuthorityRecord[] };
}

function binding(principal: ResumableIngestPrincipal, session: ResumableMediaSession) {
  if (principal.workspaceId !== session.workspaceId || principal.deviceId !== session.deviceId) {
    throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_BINDING_MISMATCH');
  }
}

async function atomicWrite(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, filePath);
}

/**
 * Independent, durable server-side authority for physical resumable acceptance.
 * Mobile never writes offsets, quota, catalog or verification values here.
 * Upload success is intentionally independent of this ledger: callers should
 * treat recorder failures as acceptance-evidence failures, not ingest failures.
 */
export class PhysicalResumableServerAuthorityLedger implements PhysicalResumableServerAuthority {
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly sources: PhysicalResumableAuthoritySources,
    private readonly now: () => number = Date.now,
  ) {}

  private isoNow() { return new Date(this.now()).toISOString(); }

  private async load(): Promise<AuthorityLedger> {
    try {
      return parseLedger(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { version: 1, records: [] };
      throw error;
    }
  }

  private async mutate(fn: (ledger: AuthorityLedger) => Promise<void> | void): Promise<void> {
    const next = this.mutation.then(async () => {
      const ledger = await this.load();
      await fn(ledger);
      await atomicWrite(this.filePath, ledger);
    });
    this.mutation = next.catch(() => undefined);
    return next;
  }

  async sessionCreated(principal: ResumableIngestPrincipal, session: ResumableMediaSession): Promise<void> {
    binding(principal, session);
    const counters = await this.sources.counters(session.workspaceId, session);
    await this.mutate(ledger => {
      const existing = ledger.records.find(item => item.sessionId === session.sessionId);
      if (existing) {
        if (existing.workspaceId !== session.workspaceId || existing.deviceId !== session.deviceId || existing.assetId !== session.assetId) {
          throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_SESSION_CONFLICT');
        }
        return;
      }
      ledger.records.push({
        version: 1,
        workspaceId: session.workspaceId,
        deviceId: session.deviceId,
        assetId: session.assetId,
        sessionId: session.sessionId,
        expectedBytes: session.expectedBytes,
        createdAt: this.isoNow(),
        quotaBefore: { bytes: counters.quotaBytes, observedAt: counters.observedAt },
        catalogBefore: { rows: counters.catalogRows, observedAt: counters.observedAt },
        status: [],
      });
    });
  }

  async statusObserved(principal: ResumableIngestPrincipal, session: ResumableMediaSession): Promise<void> {
    binding(principal, session);
    const observedAt = this.isoNow();
    await this.mutate(ledger => {
      const record = ledger.records.find(item => item.sessionId === session.sessionId);
      if (!record || record.workspaceId !== session.workspaceId || record.deviceId !== session.deviceId || record.assetId !== session.assetId) {
        throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_SESSION_NOT_FOUND');
      }
      record.status.push({ bytes: session.acknowledgedBytes, observedAt });
      if (record.status.length > 16) record.status.splice(0, record.status.length - 16);
    });
  }

  async finalized(
    principal: ResumableIngestPrincipal,
    session: ResumableMediaSession,
    result: PhysicalResumableAuthorityFinalizeResult,
  ): Promise<void> {
    binding(principal, session);
    const counters = await this.sources.counters(session.workspaceId, session);
    const observedAt = this.isoNow();
    await this.mutate(ledger => {
      const record = ledger.records.find(item => item.sessionId === session.sessionId);
      if (!record || record.workspaceId !== session.workspaceId || record.deviceId !== session.deviceId || record.assetId !== session.assetId) {
        throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_SESSION_NOT_FOUND');
      }
      record.final = {
        receivedBytes: session.acknowledgedBytes,
        assetVerified: result?.state === 'COMMITTED' && session.acknowledgedBytes === session.expectedBytes,
        quotaAfter: { bytes: counters.quotaBytes, observedAt: counters.observedAt },
        catalogAfter: { rows: counters.catalogRows, observedAt: counters.observedAt },
        observedAt,
      };
    });
  }

  async observe(input: {
    workspaceId: string;
    deviceId: string;
    assetId: string;
    sessionId: string;
    runId: string;
  }): Promise<PhysicalResumableServerAuthoritySnapshot> {
    if (![input.workspaceId, input.deviceId, input.assetId, input.sessionId, input.runId].every(nonEmpty)) {
      throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_BINDING_REQUIRED');
    }
    await this.mutation;
    const record = (await this.load()).records.find(item => item.sessionId === input.sessionId);
    if (!record || record.workspaceId !== input.workspaceId || record.deviceId !== input.deviceId || record.assetId !== input.assetId) {
      throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_BINDING_MISMATCH');
    }
    if (!record.final) throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_FINAL_NOT_OBSERVED');
    const offset = record.status.at(-1);
    if (!offset) throw new Error('PHYSICAL_RESUMABLE_AUTHORITY_RESTART_OFFSET_NOT_OBSERVED');
    return {
      offsetAfterRestart: { ...offset },
      finalReceivedBytes: record.final.receivedBytes,
      finalAssetVerified: record.final.assetVerified,
      quotaBefore: { ...record.quotaBefore },
      quotaAfter: { ...record.final.quotaAfter },
      catalogBefore: { ...record.catalogBefore },
      catalogAfter: { ...record.final.catalogAfter },
    };
  }
}
