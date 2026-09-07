export type ResumableUploadSession = {
  sessionId: string;
  expectedBytes: number;
  acknowledgedBytes: number;
  expiresAt: string;
};

export type ResumableUploadAsset = {
  assetId: string;
  filename: string;
  mimeType: string;
  mediaType: 'photo' | 'video';
  createdAt: number;
  expectedBytes: number;
};

export type ResumableUploadSessionStore = {
  load(assetId: string): Promise<ResumableUploadSession | null>;
  save(assetId: string, session: ResumableUploadSession): Promise<void>;
  remove(assetId: string): Promise<void>;
};

export type ResumableUploadSource = {
  size: number;
  readChunk(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  sha256(signal?: AbortSignal): Promise<string>;
};

export type ResumableUploadProgress = {
  sessionId: string;
  uploadedBytes: number;
  totalBytes: number;
};

export type ResumableUploadClientOptions = {
  baseUrl: string;
  getHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  sessionStore: ResumableUploadSessionStore;
  fetchImpl?: typeof fetch;
  chunkBytes?: number;
  onUnauthorized?: () => Promise<void>;
};

type ErrorBody = { error?: string; acknowledgedBytes?: number };

export class ResumableUploadHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body?: ErrorBody,
  ) {
    super(`${code} (${status})`);
    this.name = 'ResumableUploadHttpError';
  }
}

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, '');
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('RESUMABLE_UPLOAD_ABORTED');
  error.name = 'AbortError';
  throw error;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ErrorBody & T;
  if (!response.ok) {
    throw new ResumableUploadHttpError(response.status, body.error || 'RESUMABLE_UPLOAD_FAILED', body);
  }
  return body as T;
}

function validateSession(session: ResumableUploadSession, expectedBytes: number) {
  if (!session.sessionId) throw new Error('INVALID_UPLOAD_SESSION_ID');
  if (!Number.isSafeInteger(session.expectedBytes) || session.expectedBytes !== expectedBytes) throw new Error('UPLOAD_SESSION_SIZE_MISMATCH');
  if (!Number.isSafeInteger(session.acknowledgedBytes) || session.acknowledgedBytes < 0 || session.acknowledgedBytes > expectedBytes) {
    throw new Error('INVALID_UPLOAD_ACKNOWLEDGED_BYTES');
  }
  return session;
}

export class ResumableUploadClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly chunkBytes: number;

  constructor(private readonly options: ResumableUploadClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl || fetch;
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!this.baseUrl) throw new Error('RESUMABLE_UPLOAD_BASE_URL_REQUIRED');
    if (!Number.isSafeInteger(this.chunkBytes) || this.chunkBytes <= 0) throw new Error('INVALID_RESUMABLE_CHUNK_BYTES');
  }

  private endpoint(path = '') {
    return `${this.baseUrl}/api/v1/media/uploads${path}`;
  }

  private async headers(extra: Record<string, string> = {}) {
    return { ...(await this.options.getHeaders()), ...extra };
  }

  private async request(url: string, initFactory: () => Promise<RequestInit>, signal?: AbortSignal) {
    const send = async () => {
      assertNotAborted(signal);
      const init = await initFactory();
      assertNotAborted(signal);
      return this.fetchImpl(url, signal ? { ...init, signal } : init);
    };

    let response = await send();
    if (response.status === 401 && this.options.onUnauthorized) {
      assertNotAborted(signal);
      await this.options.onUnauthorized();
      response = await send();
    }
    return response;
  }

  private async createSession(asset: ResumableUploadAsset, signal?: AbortSignal) {
    const response = await this.request(this.endpoint(), async () => ({
      method: 'POST',
      headers: await this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(asset),
    }), signal);
    const session = validateSession(await parseResponse<ResumableUploadSession>(response), asset.expectedBytes);
    assertNotAborted(signal);
    await this.options.sessionStore.save(asset.assetId, session);
    return session;
  }

  private async refreshSession(asset: ResumableUploadAsset, session: ResumableUploadSession, signal?: AbortSignal) {
    const response = await this.request(this.endpoint(`/${encodeURIComponent(session.sessionId)}`), async () => ({
      method: 'GET',
      headers: await this.headers(),
    }), signal);
    if (response.status === 404 || response.status === 410) {
      assertNotAborted(signal);
      await this.options.sessionStore.remove(asset.assetId);
      return this.createSession(asset, signal);
    }
    const current = validateSession(await parseResponse<ResumableUploadSession>(response), asset.expectedBytes);
    assertNotAborted(signal);
    await this.options.sessionStore.save(asset.assetId, current);
    return current;
  }

  private async loadOrCreateSession(asset: ResumableUploadAsset, signal?: AbortSignal) {
    assertNotAborted(signal);
    const stored = await this.options.sessionStore.load(asset.assetId);
    assertNotAborted(signal);
    if (!stored || stored.expectedBytes !== asset.expectedBytes) {
      if (stored) await this.options.sessionStore.remove(asset.assetId);
      return this.createSession(asset, signal);
    }
    return this.refreshSession(asset, stored, signal);
  }

  private async appendChunk(asset: ResumableUploadAsset, session: ResumableUploadSession, chunk: Uint8Array, signal?: AbortSignal) {
    const response = await this.request(this.endpoint(`/${encodeURIComponent(session.sessionId)}/chunks`), async () => ({
      method: 'PATCH',
      headers: await this.headers({
        'content-type': 'application/octet-stream',
        'x-photox-upload-offset': String(session.acknowledgedBytes),
      }),
      body: new Uint8Array(chunk).buffer,
    }), signal);
    if (response.status === 409) {
      const body = await response.json().catch(() => ({})) as ErrorBody;
      if (body.error === 'UPLOAD_OFFSET_MISMATCH' && Number.isSafeInteger(body.acknowledgedBytes)) {
        const reconciled = validateSession({ ...session, acknowledgedBytes: Number(body.acknowledgedBytes) }, asset.expectedBytes);
        assertNotAborted(signal);
        await this.options.sessionStore.save(asset.assetId, reconciled);
        return reconciled;
      }
      throw new ResumableUploadHttpError(response.status, body.error || 'RESUMABLE_UPLOAD_FAILED', body);
    }
    if (response.status === 404 || response.status === 410) {
      assertNotAborted(signal);
      await this.options.sessionStore.remove(asset.assetId);
      return this.createSession(asset, signal);
    }
    const updated = validateSession(await parseResponse<ResumableUploadSession>(response), asset.expectedBytes);
    assertNotAborted(signal);
    await this.options.sessionStore.save(asset.assetId, updated);
    return updated;
  }

  async upload(
    asset: ResumableUploadAsset,
    source: ResumableUploadSource,
    onProgress?: (progress: ResumableUploadProgress) => void,
    signal?: AbortSignal,
  ) {
    if (source.size !== asset.expectedBytes) throw new Error('UPLOAD_SOURCE_SIZE_MISMATCH');
    assertNotAborted(signal);
    let session = await this.loadOrCreateSession(asset, signal);
    assertNotAborted(signal);
    onProgress?.({ sessionId: session.sessionId, uploadedBytes: session.acknowledgedBytes, totalBytes: asset.expectedBytes });

    while (session.acknowledgedBytes < asset.expectedBytes) {
      assertNotAborted(signal);
      const length = Math.min(this.chunkBytes, asset.expectedBytes - session.acknowledgedBytes);
      const chunk = await source.readChunk(session.acknowledgedBytes, length, signal);
      assertNotAborted(signal);
      if (chunk.byteLength !== length) throw new Error('UPLOAD_SOURCE_CHUNK_SIZE_MISMATCH');
      session = await this.appendChunk(asset, session, chunk, signal);
      assertNotAborted(signal);
      onProgress?.({ sessionId: session.sessionId, uploadedBytes: session.acknowledgedBytes, totalBytes: asset.expectedBytes });
    }

    assertNotAborted(signal);
    const sha256 = await source.sha256(signal);
    assertNotAborted(signal);
    const response = await this.request(this.endpoint(`/${encodeURIComponent(session.sessionId)}/finalize`), async () => ({
      method: 'POST',
      headers: await this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ sha256 }),
    }), signal);
    const result = await parseResponse<unknown>(response);
    assertNotAborted(signal);
    await this.options.sessionStore.remove(asset.assetId);
    return result;
  }
}
