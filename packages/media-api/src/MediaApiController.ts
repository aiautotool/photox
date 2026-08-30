import { AuthorizationService, bearerToken, type MediaApiScope } from './auth';
import { MediaContentService } from './MediaContentService';
import { MediaViewService } from './MediaViewService';
import type { MediaListQuery } from './types';

export interface ApiRequest {
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers?: Record<string, string>;
  body: T;
}

export class MediaApiController {
  constructor(
    private readonly views: MediaViewService,
    private readonly content: MediaContentService,
    private readonly auth?: AuthorizationService,
  ) {}

  async list(request: ApiRequest): Promise<ApiResponse> {
    await this.authorize(request, ['media:read']);
    const query = parseQuery(request.query ?? {});
    return { status: 200, body: await this.views.list(query) };
  }

  async detail(request: ApiRequest): Promise<ApiResponse> {
    await this.authorize(request, ['media:read']);
    const id = requireParam(request, 'id');
    const media = await this.views.get(id);
    return media ? { status: 200, body: media } : { status: 404, body: { error: 'MEDIA_NOT_FOUND' } };
  }

  async thumbnail(request: ApiRequest): Promise<ApiResponse> {
    await this.authorize(request, ['media:read']);
    const result = await this.content.thumbnail(requireParam(request, 'id'));
    return { status: result.status, headers: result.headers, body: result.body };
  }

  async preview(request: ApiRequest): Promise<ApiResponse> {
    await this.authorize(request, ['media:read']);
    const result = await this.content.preview(requireParam(request, 'id'));
    return { status: result.status, headers: result.headers, body: result.body };
  }

  async original(request: ApiRequest): Promise<ApiResponse> {
    await this.authorize(request, ['media:download']);
    const range = header(request, 'range');
    const result = await this.content.original(requireParam(request, 'id'), range);
    return { status: result.status, headers: result.headers, body: result.body };
  }

  private async authorize(request: ApiRequest, scopes: MediaApiScope[]) {
    if (!this.auth) return;
    await this.auth.authorize(bearerToken(header(request, 'authorization')), scopes);
  }
}

function requireParam(request: ApiRequest, key: string): string {
  const value = request.params?.[key];
  if (!value) throw new Error(`MISSING_PARAM:${key}`);
  return value;
}
function header(request: ApiRequest, name: string): string | undefined {
  const headers = request.headers ?? {};
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}
function parseQuery(q: Record<string, string | undefined>): MediaListQuery {
  const limit = q.limit ? Number(q.limit) : undefined;
  return {
    cursor: q.cursor,
    limit: Number.isFinite(limit) ? limit : undefined,
    type: q.type as MediaListQuery['type'],
    from: q.from,
    to: q.to,
    favorite: q.favorite === undefined ? undefined : q.favorite === 'true',
    albumId: q.albumId,
    health: q.health as MediaListQuery['health'],
    providerId: q.providerId,
    edited: q.edited === undefined ? undefined : q.edited === 'true',
    search: q.search,
  };
}
