import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { StorageProviderRegistry } from '../storage/StorageProviderRegistry.js';
import type { DownloadInput } from '../storage/StorageProvider.js';

export type MobileLibraryItem = {
  key: string;
  assetId: string;
  filename: string;
  size: number;
  createdAt: number;
  mediaType: 'photo' | 'video';
  localAvailable: boolean;
  cloudAvailable: boolean;
};

export type MobileMediaLocation = {
  localPath?: string;
  replicas?: Array<{
    providerId: string;
    accountId: string;
    remoteFileId: string;
  }>;
};

export type MobileApiDependencies = {
  pairCode: () => Promise<string>;
  status: () => Promise<Record<string, unknown>>;
  listLibrary: () => Promise<MobileLibraryItem[]>;
  receiveMedia: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  resolveMedia: (key: string) => Promise<MobileMediaLocation | null>;
  streamLocalMedia: (path: string, req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
};

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

/**
 * Stable API boundary consumed by mobile clients.
 * Mobile never needs to know which remote storage provider holds a file.
 */
export class MobileApiService {
  private server: http.Server | null = null;

  constructor(
    private readonly registry: StorageProviderRegistry,
    private readonly deps: MobileApiDependencies,
    private readonly port = 43117,
  ) {}

  async start(host = '0.0.0.0'): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, host, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    await new Promise<void>(resolve => current.close(() => resolve()));
  }

  private async authorize(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const expected = await this.deps.pairCode();
    if (req.headers['x-photosync-pair-code'] !== expected) {
      json(res, 401, { error: 'INVALID_PAIR_CODE' });
      return false;
    }
    return true;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!(await this.authorize(req, res))) return;
      const url = new URL(req.url || '/', 'http://desktop.local');

      if (req.method === 'GET' && url.pathname === '/api/v1/status') {
        json(res, 200, await this.deps.status());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/library') {
        json(res, 200, await this.deps.listLibrary());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/storage/providers') {
        const providers = await Promise.all(this.registry.list().map(async provider => ({
          id: provider.id,
          displayName: provider.displayName,
          healthy: provider.healthCheck ? await provider.healthCheck().catch(() => false) : true,
          accounts: await provider.listAccounts().catch(() => []),
        })));
        json(res, 200, providers);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/media') {
        await this.deps.receiveMedia(req, res);
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/v1/media/')) {
        const key = decodeURIComponent(url.pathname.slice('/api/v1/media/'.length));
        const location = await this.deps.resolveMedia(key);
        if (!location) {
          json(res, 404, { error: 'MEDIA_NOT_FOUND' });
          return;
        }

        if (location.localPath && await this.deps.streamLocalMedia(location.localPath, req, res)) return;

        for (const replica of location.replicas || []) {
          if (!this.registry.has(replica.providerId)) continue;
          try {
            const provider = this.registry.get(replica.providerId);
            const input: DownloadInput = {
              accountId: replica.accountId,
              remoteFileId: replica.remoteFileId,
              range: typeof req.headers.range === 'string' ? req.headers.range : undefined,
            };
            const remote = await provider.download(input);
            res.writeHead(remote.status, remote.headers);
            remote.body.pipe(res);
            return;
          } catch {
            // Try the next replica/provider.
          }
        }

        json(res, 503, { error: 'MEDIA_TEMPORARILY_UNAVAILABLE' });
        return;
      }

      json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      json(res, 500, { error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }
}
