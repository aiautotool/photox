import http from 'node:http';
import crypto from 'node:crypto';

export type RelayHostSocket = {
  readyState: number;
  send(data: string): void;
};

type BrokerResponse = {
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};

type PendingRequest = {
  desktopId: string;
  resolve: (response: BrokerResponse) => void;
  timeout: NodeJS.Timeout;
};

type ResumableRelayBrokerOptions = {
  getHostSocket: (desktopId: string) => RelayHostSocket | undefined;
  openReadyState?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

const DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'x-photosync-workspace-id',
  'x-photosync-pairing-challenge',
  'x-photosync-pair-code',
  'x-photosync-pair-token',
  'x-photosync-device-id',
  'x-photox-upload-offset',
] as const;

function clean(value: string | string[] | undefined, max = 4096) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw || '').replace(/[\r\n]/g, '').slice(0, max);
}

function isAllowedRoute(method: string | undefined, pathname: string) {
  if (pathname === '/api/v1/media/uploads') return method === 'POST';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+$/.test(pathname)) return method === 'GET';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+\/chunks$/.test(pathname)) return method === 'PATCH';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+\/finalize$/.test(pathname)) return method === 'POST';
  return false;
}

async function readBoundedBody(req: http.IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('RELAY_RESUMABLE_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks, bytes) : Buffer.alloc(0);
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

export class ResumableRelayBroker {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly openReadyState: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: ResumableRelayBrokerOptions) {
    this.openReadyState = options.openReadyState ?? 1;
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get pendingCount() { return this.pending.size; }

  async handleHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/v1/media/uploads')) return false;
    if (!isAllowedRoute(req.method, url.pathname)) {
      json(res, 404, { error: 'RESUMABLE_RELAY_ROUTE_NOT_FOUND' });
      return true;
    }

    const desktopId = clean(req.headers['x-photosync-relay-desktop-id']);
    const pairToken = clean(req.headers['x-photosync-pair-token']);
    if (!desktopId || !pairToken) {
      json(res, 401, { error: 'RELAY_DESKTOP_AUTH_REQUIRED' });
      return true;
    }
    const socket = this.options.getHostSocket(desktopId);
    if (!socket || socket.readyState !== this.openReadyState) {
      json(res, 503, { error: 'RELAY_DESKTOP_OFFLINE' });
      return true;
    }

    let body: Buffer;
    try {
      body = req.method === 'GET' ? Buffer.alloc(0) : await readBoundedBody(req, this.maxRequestBytes);
    } catch (error) {
      json(res, 413, { error: error instanceof Error ? error.message : 'RELAY_RESUMABLE_REQUEST_TOO_LARGE' });
      return true;
    }

    const headers: Record<string, string> = {};
    for (const name of REQUEST_HEADERS) {
      const value = clean(req.headers[name]);
      if (value) headers[name] = value;
    }

    const requestId = crypto.randomUUID();
    const response = await new Promise<BrokerResponse>(resolve => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ status: 504, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ error: 'RELAY_DESKTOP_TIMEOUT' })).toString('base64') });
      }, this.timeoutMs);
      timeout.unref();
      this.pending.set(requestId, { desktopId, resolve, timeout });
      try {
        socket.send(JSON.stringify({
          type: 'resumable.request',
          requestId,
          method: req.method,
          path: url.pathname,
          headers,
          ...(body.byteLength ? { bodyBase64: body.toString('base64') } : {}),
        }));
      } catch {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        resolve({ status: 503, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ error: 'RELAY_DESKTOP_OFFLINE' })).toString('base64') });
      }
    });

    let responseBody = Buffer.alloc(0);
    try {
      if (response.bodyBase64) responseBody = Buffer.from(response.bodyBase64, 'base64');
      if (responseBody.byteLength > this.maxResponseBytes) throw new Error('too large');
    } catch {
      json(res, 502, { error: 'RELAY_DESKTOP_RESPONSE_INVALID' });
      return true;
    }
    const contentType = clean(response.headers?.['content-type']) || 'application/json; charset=utf-8';
    const retryAfter = clean(response.headers?.['retry-after']);
    res.writeHead(response.status, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    });
    res.end(responseBody);
    return true;
  }

  handleDesktopMessage(desktopId: string, raw: unknown) {
    let message: any;
    try { message = JSON.parse(String(raw)); } catch { return false; }
    if (message?.type !== 'resumable.response' || typeof message.requestId !== 'string') return false;
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.desktopId !== desktopId) return false;
    const status = Number(message.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) return false;
    clearTimeout(pending.timeout);
    this.pending.delete(message.requestId);
    pending.resolve({
      status,
      headers: message.headers && typeof message.headers === 'object' ? message.headers as Record<string, string> : {},
      bodyBase64: typeof message.bodyBase64 === 'string' ? message.bodyBase64 : undefined,
    });
    return true;
  }

  handleDesktopDisconnect(desktopId: string) {
    for (const [requestId, item] of this.pending) {
      if (item.desktopId !== desktopId) continue;
      clearTimeout(item.timeout);
      this.pending.delete(requestId);
      item.resolve({ status: 503, headers: { 'content-type': 'application/json' }, bodyBase64: Buffer.from(JSON.stringify({ error: 'RELAY_DESKTOP_OFFLINE' })).toString('base64') });
    }
  }
}
