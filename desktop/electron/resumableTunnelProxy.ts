export type RelayResumableRequest = {
  requestId: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type RelayResumableResponse = {
  requestId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type ResumableTunnelProxyOptions = {
  receiverBaseUrl?: string;
  expectedPairToken: string;
  fetchImpl?: typeof fetch;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
};

const DEFAULT_MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const SAFE_REQUEST_HEADERS = new Set([
  'authorization',
  'content-type',
  'x-photosync-workspace-id',
  'x-photosync-pairing-challenge',
  'x-photosync-pair-code',
  'x-photosync-device-id',
  'x-photox-upload-offset',
]);

function normalizeHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

function validateRoute(method: RelayResumableRequest['method'], pathname: string) {
  if (pathname === '/api/v1/media/uploads') return method === 'POST';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+$/.test(pathname)) return method === 'GET';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+\/chunks$/.test(pathname)) return method === 'PATCH';
  if (/^\/api\/v1\/media\/uploads\/[^/?#]+\/finalize$/.test(pathname)) return method === 'POST';
  if (pathname === '/api/v1/auth/pair') return method === 'POST';
  if (pathname === '/api/v1/auth/refresh') return method === 'POST';
  if (pathname === '/api/v1/auth/revoke') return method === 'POST';
  return false;
}

function decodeBody(value: string | undefined, maxBytes: number) {
  if (!value) return undefined;
  const body = Buffer.from(value, 'base64');
  if (body.byteLength > maxBytes) throw new Error('RELAY_RESUMABLE_REQUEST_TOO_LARGE');
  return body;
}

export async function proxyResumableTunnelRequest(
  request: RelayResumableRequest,
  options: ResumableTunnelProxyOptions,
): Promise<RelayResumableResponse> {
  if (!request.requestId || request.requestId.length > 160) throw new Error('INVALID_RELAY_RESUMABLE_REQUEST_ID');
  if (!validateRoute(request.method, request.path)) throw new Error('INVALID_RELAY_RESUMABLE_ROUTE');

  const incomingHeaders = normalizeHeaders(request.headers || {});
  if (!options.expectedPairToken || incomingHeaders['x-photosync-pair-token'] !== options.expectedPairToken) {
    throw new Error('INVALID_RELAY_PAIR_TOKEN');
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (SAFE_REQUEST_HEADERS.has(key) && value) headers[key] = value;
  }

  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const body = decodeBody(request.bodyBase64, maxRequestBytes);
  if (request.method === 'GET' && body?.byteLength) throw new Error('RELAY_RESUMABLE_GET_BODY_NOT_ALLOWED');

  const receiverBaseUrl = (options.receiverBaseUrl || 'http://127.0.0.1:43117').replace(/\/$/, '');
  const response = await (options.fetchImpl || fetch)(`${receiverBaseUrl}${request.path}`, {
    method: request.method,
    headers,
    ...(body ? { body: new Uint8Array(body).buffer } : {}),
  });
  const responseBody = Buffer.from(await response.arrayBuffer());
  if (responseBody.byteLength > maxResponseBytes) throw new Error('RELAY_RESUMABLE_RESPONSE_TOO_LARGE');

  const responseHeaders: Record<string, string> = {};
  const contentType = response.headers.get('content-type');
  const retryAfter = response.headers.get('retry-after');
  if (contentType) responseHeaders['content-type'] = contentType;
  if (retryAfter) responseHeaders['retry-after'] = retryAfter;

  return {
    requestId: request.requestId,
    status: response.status,
    headers: responseHeaders,
    ...(responseBody.byteLength ? { bodyBase64: responseBody.toString('base64') } : {}),
  };
}