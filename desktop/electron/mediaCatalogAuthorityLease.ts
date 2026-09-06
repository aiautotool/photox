import crypto from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type MediaCatalogAuthorityOwner = 'desktop-runtime' | 'operator-export';

type LeaseRecord = {
  version: 1;
  token: string;
  pid: number;
  owner: MediaCatalogAuthorityOwner;
  createdAt: string;
};

export type MediaCatalogAuthorityLease = {
  path: string;
  owner: MediaCatalogAuthorityOwner;
  release(): void;
};

function parseLease(leasePath: string): LeaseRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(leasePath, 'utf8'));
  } catch {
    throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_INVALID');
  const row = parsed as Partial<LeaseRecord>;
  if (row.version !== 1 || typeof row.token !== 'string' || !row.token || !Number.isInteger(row.pid) || Number(row.pid) <= 0
    || (row.owner !== 'desktop-runtime' && row.owner !== 'operator-export') || typeof row.createdAt !== 'string') {
    throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_INVALID');
  }
  return row as LeaseRecord;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Process lease for the single SQLite media-catalog authority.
 *
 * Both Desktop runtime and offline operator tooling take this exact lease. A live
 * holder always blocks the other side, so export can never race active runtime
 * mutation or accidentally create a dual-authority window. Stale leases left by
 * a crashed process are reclaimed only when the recorded PID is proven absent;
 * malformed/ambiguous leases fail closed.
 */
export function acquireMediaCatalogAuthorityLease(
  leasePath: string,
  owner: MediaCatalogAuthorityOwner,
): MediaCatalogAuthorityLease {
  if (!leasePath.trim()) throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_PATH_REQUIRED');
  mkdirSync(path.dirname(leasePath), { recursive: true });

  const record: LeaseRecord = {
    version: 1,
    token: crypto.randomUUID(),
    pid: process.pid,
    owner,
    createdAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd: number | undefined;
    try {
      fd = openSync(leasePath, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify(record)}\n`, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;

      let released = false;
      return {
        path: leasePath,
        owner,
        release() {
          if (released) return;
          const current = parseLease(leasePath);
          if (current.token !== record.token || current.pid !== record.pid || current.owner !== record.owner) {
            throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_OWNERSHIP_LOST');
          }
          unlinkSync(leasePath);
          released = true;
        },
      };
    } catch (error) {
      if (fd !== undefined) closeSync(fd);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const current = parseLease(leasePath);
      if (isProcessAlive(current.pid)) {
        throw new Error(`MEDIA_CATALOG_AUTHORITY_ACTIVE:${current.owner}:${current.pid}`);
      }
      unlinkSync(leasePath);
    }
  }

  throw new Error('MEDIA_CATALOG_AUTHORITY_LOCK_UNAVAILABLE');
}

export function mediaCatalogAuthorityLeaseExists(leasePath: string): boolean {
  return existsSync(leasePath);
}
