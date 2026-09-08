import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  parsePhysicalResumableAcceptanceEvidence,
  type PhysicalResumableAcceptanceEvidence,
} from './physicalResumableAcceptanceEvidence.js';

type PersistedEvidenceLedger = {
  version: 1;
  evidence: PhysicalResumableAcceptanceEvidence[];
};

function parseLedger(value: unknown): PersistedEvidenceLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { version: 1, evidence: [] };
  const input = value as Record<string, unknown>;
  if (input.version !== 1 || !Array.isArray(input.evidence)) return { version: 1, evidence: [] };
  const evidence = input.evidence
    .map(parsePhysicalResumableAcceptanceEvidence)
    .filter((item): item is PhysicalResumableAcceptanceEvidence => item !== undefined);
  return { version: 1, evidence };
}

/**
 * Append-only durable evidence ledger. Invalid/corrupt persisted data fails
 * closed to an empty ledger, which can never grant resumable acceptance.
 */
export class PhysicalResumableAcceptanceEvidenceStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PhysicalResumableAcceptanceEvidence[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return parseLedger(JSON.parse(raw)).evidence;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async append(input: unknown): Promise<PhysicalResumableAcceptanceEvidence> {
    const parsed = parsePhysicalResumableAcceptanceEvidence(input);
    if (!parsed) throw new Error('INVALID_PHYSICAL_RESUMABLE_ACCEPTANCE_EVIDENCE');

    const existing = await this.load();
    if (existing.some((item) => item.evidenceId === parsed.evidenceId)) {
      throw new Error('PHYSICAL_RESUMABLE_ACCEPTANCE_EVIDENCE_ID_EXISTS');
    }
    const ledger: PersistedEvidenceLedger = { version: 1, evidence: [...existing, parsed] };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    return parsed;
  }
}
