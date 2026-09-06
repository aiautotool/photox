import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createMediaIngestCommitCoordinator } from './mediaIngestCommitCoordinator.js';
import { ResumableMediaIngestStore, type CreateResumableMediaSessionInput, type ResumableMediaSession } from './resumableMediaIngest.js';

export type ResumableIngestPrincipal = {
  workspaceId: string;
  deviceId: string;
};

export type ResumableIngestCommitInput = {
  workspaceId: string;
  key: string;
  session: ResumableMediaSession;
  partPath: string;
  sha256: string;
};

export type ResumableQuotaReservation = {
  reservationId: string;
};

export type ResumableQuotaReservationHooks = {
  reserve(input: { principal: ResumableIngestPrincipal; expectedBytes: number; assetId: string }): Promise<ResumableQuotaReservation>;
  commit(input: { principal: ResumableIngestPrincipal; reservationId: string; expectedBytes: number; key: string }): Promise<void>;
  release(input: { principal: ResumableIngestPrincipal; reservationId: string; expectedBytes: number; reason: 'duplicate' | 'expired' | 'create_failed' }): Promise<void>;
};

export type ResumableIngestLifecycleDependencies<T> = {
  store: ResumableMediaIngestStore;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  commit(input: ResumableIngestCommitInput): Promise<T>;
  quota?: ResumableQuotaReservationHooks;
};

function requiredIdentity(value: string, code: string) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeSha256(value: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('UPLOAD_SHA256_REQUIRED');
  return normalized;
}

async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function binding(principal: ResumableIngestPrincipal) {
  return {
    workspaceId: requiredIdentity(principal.workspaceId, 'WORKSPACE_SCOPE_REQUIRED'),
    deviceId: requiredIdentity(principal.deviceId, 'DEVICE_SCOPE_REQUIRED'),
  };
}

function quotaReservationId(session: ResumableMediaSession) {
  return session.quotaReservationId ? requiredIdentity(session.quotaReservationId, 'UPLOAD_QUOTA_RESERVATION_INVALID') : undefined;
}

export function createResumableMediaIngestLifecycle<T>(deps: ResumableIngestLifecycleDependencies<T>) {
  const coordinator = createMediaIngestCommitCoordinator();

  async function create(principal: ResumableIngestPrincipal, input: Omit<CreateResumableMediaSessionInput, 'workspaceId' | 'deviceId' | 'quotaReservationId'>) {
    const actor = binding(principal);
    let reservation: ResumableQuotaReservation | undefined;
    if (deps.quota) {
      reservation = await deps.quota.reserve({ principal: actor, expectedBytes: input.expectedBytes, assetId: input.assetId });
      requiredIdentity(reservation.reservationId, 'UPLOAD_QUOTA_RESERVATION_REQUIRED');
    }
    try {
      return await deps.store.create({ ...input, ...actor, quotaReservationId: reservation?.reservationId });
    } catch (error) {
      if (reservation && deps.quota) {
        await deps.quota.release({ principal: actor, reservationId: reservation.reservationId, expectedBytes: input.expectedBytes, reason: 'create_failed' });
      }
      throw error;
    }
  }

  async function status(principal: ResumableIngestPrincipal, sessionId: string) {
    const actor = binding(principal);
    return deps.store.get(requiredIdentity(sessionId, 'UPLOAD_SESSION_ID_REQUIRED'), actor);
  }

  async function appendChunk(principal: ResumableIngestPrincipal, input: { sessionId: string; offset: number; chunk: Uint8Array }) {
    const actor = binding(principal);
    return deps.store.appendChunk({ ...input, ...actor, sessionId: requiredIdentity(input.sessionId, 'UPLOAD_SESSION_ID_REQUIRED') });
  }

  async function finalize(principal: ResumableIngestPrincipal, input: { sessionId: string; sha256: string }) {
    const actor = binding(principal);
    const sessionId = requiredIdentity(input.sessionId, 'UPLOAD_SESSION_ID_REQUIRED');
    const expectedSha256 = normalizeSha256(input.sha256);
    const complete = await deps.store.requireComplete(sessionId, actor);
    const authoritativeSha256 = await sha256File(complete.partPath);
    if (authoritativeSha256 !== expectedSha256) throw new Error('UPLOAD_SHA256_MISMATCH');

    const key = `${complete.session.deviceId}:${complete.session.assetId}`;
    const outcome = await coordinator.run({ workspaceId: complete.session.workspaceId, key }, {
      exists: () => deps.exists({ workspaceId: complete.session.workspaceId, key }),
      commit: () => deps.commit({
        workspaceId: complete.session.workspaceId,
        key,
        session: complete.session,
        partPath: complete.partPath,
        sha256: authoritativeSha256,
      }),
    });

    const reservationId = quotaReservationId(complete.session);
    if (reservationId && deps.quota) {
      if (outcome.status === 'duplicate') {
        await deps.quota.release({ principal: actor, reservationId, expectedBytes: complete.session.expectedBytes, reason: 'duplicate' });
      } else {
        await deps.quota.commit({ principal: actor, reservationId, expectedBytes: complete.session.expectedBytes, key });
      }
    }
    await deps.store.remove(sessionId);
    return outcome.status === 'duplicate'
      ? { state: 'ALREADY_RECEIVED' as const, key, sha256: authoritativeSha256 }
      : { state: 'COMMITTED' as const, key, sha256: authoritativeSha256, value: outcome.value };
  }

  async function cleanupExpired() {
    return deps.store.cleanupExpired(async session => {
      const reservationId = quotaReservationId(session);
      if (!reservationId || !deps.quota) return;
      await deps.quota.release({
        principal: { workspaceId: session.workspaceId, deviceId: session.deviceId },
        reservationId,
        expectedBytes: session.expectedBytes,
        reason: 'expired',
      });
    });
  }

  return { create, status, appendChunk, finalize, cleanupExpired, pendingFinalizations: coordinator.pending };
}
