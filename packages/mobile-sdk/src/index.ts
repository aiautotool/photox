import type { DesktopStatus, KeyValueStore, MediaAsset, PairingCredentials, StorageProviderDescriptor, UpdateManifest } from '@photosync/sdk-contracts';
import { compareVersions } from '@photosync/sdk-contracts';

export type MobileSdkOptions = {
  fetcher?: typeof fetch;
  store?: KeyValueStore;
  timeoutMs?: number;
};

export class PairingStore {
  private readonly key = 'photosync.pairing.v1';
  constructor(private readonly store: KeyValueStore) {}

  async load(): Promise<PairingCredentials | null> {
    const value = await this.store.get(this.key);
    if (!value) return null;
    try { return JSON.parse(value) as PairingCredentials; } catch { return null; }
  }

  save(value: PairingCredentials): Promise<void> { return this.store.set(this.key, JSON.stringify(value)); }
  clear(): Promise<void> { return this.store.remove(this.key); }
}

export class PhotoSyncDesktopClient {
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private credentials: PairingCredentials, options: MobileSdkOptions = {}) {
    this.fetcher = options.fetcher || fetch;
    this.timeoutMs = options.timeoutMs || 30_000;
  }

  setCredentials(credentials: PairingCredentials): void { this.credentials = credentials; }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers || {});
    headers.set('x-photosync-pair-code', this.credentials.pairCode);
    headers.set('x-photosync-device-id', this.credentials.deviceId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${this.credentials.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers, signal: controller.signal });
    } finally { clearTimeout(timer); }
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) throw new Error(`PhotoSync desktop HTTP ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  status(): Promise<DesktopStatus> { return this.json('/api/v1/status'); }
  library(): Promise<MediaAsset[]> { return this.json('/api/v1/library'); }
  providers(): Promise<StorageProviderDescriptor[]> { return this.json('/api/v1/storage/providers'); }

  mediaUrl(key: string): string {
    return `${this.credentials.baseUrl.replace(/\/$/, '')}/api/v1/media/${encodeURIComponent(key)}`;
  }

  async upload(input: { assetId: string; filename: string; createdAt: number; body: BodyInit; contentType?: string }): Promise<{ state: string; sha256?: string; path?: string }> {
    const headers = new Headers();
    headers.set('x-photosync-asset-id', input.assetId);
    headers.set('x-photosync-filename', encodeURIComponent(input.filename));
    headers.set('x-photosync-created-at', String(input.createdAt));
    if (input.contentType) headers.set('content-type', input.contentType);
    return this.json('/api/v1/media', { method: 'POST', headers, body: input.body });
  }
}

export type PendingSyncItem = {
  id: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
};

export class RetryPolicy {
  constructor(private readonly baseDelayMs = 2_000, private readonly maxDelayMs = 5 * 60_000) {}
  next(attempt: number): number {
    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * Math.min(1_000, exponential / 4));
    return exponential + jitter;
  }
}

export class MobileUpdateClient {
  constructor(private readonly manifestUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async check(currentVersion: string): Promise<{ available: boolean; required: boolean; manifest: UpdateManifest }> {
    const response = await this.fetcher(this.manifestUrl, { headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) throw new Error(`Update manifest HTTP ${response.status}`);
    const manifest = await response.json() as UpdateManifest;
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported update manifest schema: ${manifest.schemaVersion}`);
    return {
      available: compareVersions(manifest.version, currentVersion) > 0,
      required: Boolean(manifest.minimumSupportedVersion && compareVersions(currentVersion, manifest.minimumSupportedVersion) < 0),
      manifest,
    };
  }
}
