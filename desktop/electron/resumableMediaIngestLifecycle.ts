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

export type ResumableIngestLifecycleDependencies<T> = {
  store: ResumableMediaIngestStore;
  exists(input: { workspaceId: string; key: string }): Promise<boolean>;
  commit(input: ResumableIngestCommitInput): Promise<T>;
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

export function createResumableMediaIngestLifecycle<T>(deps: ResumableIngestLifecycleDependencies<T>) {
  const coordinator = createMediaIngestCommitCoordinator();

  async function create(principal: ResumableIngestPrincipal, input: Omit<CreateResumableMediaSessionInput, 'workspaceId' | 'deviceId'>) {
    const actor = binding(principal);
    return deps.store.create({ ...input, ...actor });
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

    await deps.store.remove(sessionId);
    return outcome.status === 'duplicate'
      ? { state: 'ALREADY_RECEIVED' as const, key, sha256: authoritativeSha256 }
      : { state: 'COMMITTED' as const, key, sha256: authoritativeSha256, value: outcome.value };
  }

  return { create, status, appendChunk, finalize, pendingFinalizations: coordinator.pending };
}
