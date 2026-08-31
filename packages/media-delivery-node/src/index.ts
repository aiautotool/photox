import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { MediaContentResponse } from '@photox/media-api';
import type { DeliveryAdapter, DeliveryCandidate } from '@photox/media-delivery';

function parseSingleRange(value: string | undefined, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match) throw new Error(`Unsupported Range header: ${value}`);
  const [, startRaw, endRaw] = match;
  let start: number;
  let end: number;
  if (!startRaw && !endRaw) throw new Error(`Invalid Range header: ${value}`);
  if (!startRaw) {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) throw new Error(`Invalid suffix range: ${value}`);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    throw new Error(`Unsatisfiable Range header: ${value}`);
  }
  return { start, end: Math.min(end, size - 1) };
}

export class LocalFileDeliveryAdapter implements DeliveryAdapter {
  readonly providerId: string;
  constructor(providerId = 'local') { this.providerId = providerId; }

  async open(candidate: DeliveryCandidate, options: { range?: string }): Promise<MediaContentResponse> {
    if (!candidate.uri) throw new Error('Local delivery candidate requires uri');
    const path = candidate.uri.startsWith('file://') ? decodeURIComponent(candidate.uri.slice(7)) : candidate.uri;
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    const range = parseSingleRange(options.range, info.size);
    const headers: Record<string, string> = {
      'accept-ranges': 'bytes',
      'content-type': candidate.mimeType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    };
    if (range) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      headers['content-length'] = String(range.end - range.start + 1);
      return { status: 206, headers, body: createReadStream(path, { start: range.start, end: range.end }) };
    }
    headers['content-length'] = String(info.size);
    return { status: 200, headers, body: createReadStream(path) };
  }
}

export interface HttpDeliveryAdapterOptions {
  providerId: string;
  resolveUrl?: (candidate: DeliveryCandidate) => Promise<string> | string;
  fetcher?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export class HttpDeliveryAdapter implements DeliveryAdapter {
  readonly providerId: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: HttpDeliveryAdapterOptions) {
    this.providerId = options.providerId;
    this.fetcher = options.fetcher ?? fetch;
  }

  async open(candidate: DeliveryCandidate, options: { range?: string }): Promise<MediaContentResponse> {
    const url = this.options.resolveUrl ? await this.options.resolveUrl(candidate) : candidate.uri;
    if (!url) throw new Error(`HTTP delivery candidate for ${candidate.providerId} has no URL`);
    const headers: Record<string, string> = { ...(this.options.defaultHeaders ?? {}) };
    if (options.range) headers.range = options.range;
    const response = await this.fetcher(url, { headers });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status} while reading ${candidate.providerId}`);
    const forwarded: Record<string, string> = {};
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(name);
      if (value) forwarded[name] = value;
    }
    return { status: response.status, headers: forwarded, body: response.body };
  }
}

export { parseSingleRange };
