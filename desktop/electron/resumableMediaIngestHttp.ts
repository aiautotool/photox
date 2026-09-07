import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResumableIngestPrincipal } from './resumableMediaIngestLifecycle.js';

export type ResumableMediaHttpLifecycle = {
  create(principal: ResumableIngestPrincipal, input: {
    assetId: string;
    filename: string;
    mimeType: string;
    mediaType: 'photo' | 'video';
    createdAt: number;
    expectedBytes: number;
  }): Promise<{ sessionId: string; expectedBytes: number; acknowledgedBytes: number; expiresAtIso: string }>;
  status(principal: ResumableIngestPrincipal, sessionId: string): Promise<{ sessionId: string; expectedBytes: number; acknowledgedBytes: number; expiresAtIso: string }>;
  appendChunk(principal: ResumableIngestPrincipal, input: { sessionId: string; offset: number; chunk: Uint8Array }): Promise<{ sessionId: string; expectedBytes: number; acknowledgedBytes: number; expiresAtIso: string }>;
  finalize(principal: ResumableIngestPrincipal, input: { sessionId: string; sha256: string }): Promise<unknown>;
};

export type ResumableMediaHttpDependencies = {
  authorize(req: IncomingMessage): Promise<ResumableIngestPrincipal>;
  lifecycle: ResumableMediaHttpLifecycle;
  maxJsonBytes?: number;
  maxChunkBytes?: number;
};

const DEFAULT_MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const BASE_PATH = '/api/v1/media/uploads';

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function publicSession(session: { sessionId: string; expectedBytes: number; acknowledgedBytes: number; expiresAtIso: string }) {
  return {
    sessionId: session.sessionId,
    expectedBytes: session.expectedBytes,
    acknowledgedBytes: session.acknowledgedBytes,
    expiresAt: session.expiresAtIso,
  };
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  const raw = await readBody(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    throw new Error('INVALID_JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_JSON');
  return parsed as Record<string, unknown>;
}

function sessionIdFromPath(pathname: string, suffix = ''): string | null {
  const prefix = `${BASE_PATH}/`;
  if (!pathname.startsWith(prefix)) return null;
  const tail = pathname.slice(prefix.length);
  if (suffix) {
    if (!tail.endsWith(suffix)) return null;
    return decodeURIComponent(tail.slice(0, -suffix.length));
  }
  if (!tail || tail.includes('/')) return null;
  return decodeURIComponent(tail);
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'REQUEST_BODY_TOO_LARGE' || message === 'UPLOAD_CHUNK_TOO_LARGE') return { status: 413, body: { error: message } };
  if (message === 'UPLOAD_SESSION_NOT_FOUND') return { status: 404, body: { error: message } };
  if (message === 'UPLOAD_SESSION_EXPIRED') return { status: 410, body: { error: message } };
  if (message === 'UPLOAD_SESSION_BINDING_MISMATCH') return { status: 403, body: { error: message } };
  if (message.startsWith('UPLOAD_OFFSET_MISMATCH:')) {
    const acknowledgedBytes = Number(message.split(':')[1]);
    return { status: 409, body: { error: 'UPLOAD_OFFSET_MISMATCH', acknowledgedBytes: Number.isSafeInteger(acknowledgedBytes) ? acknowledgedBytes : undefined } };
  }
  if (message === 'UPLOAD_SHA256_MISMATCH' || message.startsWith('UPLOAD_INCOMPLETE:')) return { status: 409, body: { error: message } };
  if (message.startsWith('MEDIA_QUOTA_') || message.startsWith('WORKSPACE_QUOTA_')) return { status: 413, body: { error: message } };
  if (message.startsWith('INVALID_') || message.startsWith('UPLOAD_') || message.endsWith('_REQUIRED')) return { status: 400, body: { error: message } };
  return { status: 500, body: { error: 'RESUMABLE_UPLOAD_FAILED' } };
}

export function createResumableMediaIngestHttpHandler(deps: ResumableMediaHttpDependencies) {
  const maxJsonBytes = deps.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
  const maxChunkBytes = deps.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES;
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes <= 0) throw new Error('INVALID_MAX_JSON_BYTES');
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes <= 0) throw new Error('INVALID_MAX_CHUNK_BYTES');

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', 'http://localhost');
    const isCreate = req.method === 'POST' && url.pathname === BASE_PATH;
    const statusSessionId = req.method === 'GET' ? sessionIdFromPath(url.pathname) : null;
    const chunkSessionId = req.method === 'PATCH' ? sessionIdFromPath(url.pathname, '/chunks') : null;
    const finalizeSessionId = req.method === 'POST' ? sessionIdFromPath(url.pathname, '/finalize') : null;
    if (!isCreate && !statusSessionId && !chunkSessionId && !finalizeSessionId) return false;

    let principal: ResumableIngestPrincipal;
    try {
      principal = await deps.authorize(req);
      if (!principal.workspaceId || !principal.deviceId) throw new Error('AUTH_PRINCIPAL_INCOMPLETE');
    } catch {
      sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return true;
    }

    try {
      if (isCreate) {
        const body = await readJson(req, maxJsonBytes);
        const session = await deps.lifecycle.create(principal, {
          assetId: String(body.assetId || ''),
          filename: String(body.filename || ''),
          mimeType: String(body.mimeType || 'application/octet-stream'),
          mediaType: body.mediaType === 'video' ? 'video' : 'photo',
          createdAt: Number(body.createdAt),
          expectedBytes: Number(body.expectedBytes),
        });
        sendJson(res, 201, publicSession(session), { location: `${BASE_PATH}/${encodeURIComponent(session.sessionId)}` });
        return true;
      }

      if (statusSessionId) {
        const session = await deps.lifecycle.status(principal, statusSessionId);
        sendJson(res, 200, publicSession(session));
        return true;
      }

      if (chunkSessionId) {
        const offset = Number(req.headers['x-photox-upload-offset']);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('INVALID_UPLOAD_OFFSET');
        const chunk = await readBody(req, maxChunkBytes);
        if (!chunk.byteLength) throw new Error('UPLOAD_CHUNK_REQUIRED');
        const session = await deps.lifecycle.appendChunk(principal, { sessionId: chunkSessionId, offset, chunk });
        sendJson(res, 200, publicSession(session), { 'x-photox-upload-offset': String(session.acknowledgedBytes) });
        return true;
      }

      if (finalizeSessionId) {
        const body = await readJson(req, maxJsonBytes);
        const result = await deps.lifecycle.finalize(principal, { sessionId: finalizeSessionId, sha256: String(body.sha256 || '') });
        sendJson(res, 200, result);
        return true;
      }
    } catch (error) {
      const mapped = errorResponse(error);
      sendJson(res, mapped.status, mapped.body);
      return true;
    }

    return false;
  };
}
