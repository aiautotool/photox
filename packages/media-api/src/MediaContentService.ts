import type { MediaVariant } from './types';

export interface MediaContentRequest {
  assetId: string;
  variant: MediaVariant;
  range?: string;
}

export interface MediaContentResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  source?: { providerId: string; accountId?: string; replicaId?: string };
}

export interface MediaContentResolver {
  resolve(request: MediaContentRequest): Promise<MediaContentResponse>;
}

export interface ThumbnailResolver {
  thumbnail(assetId: string): Promise<MediaContentResponse>;
  preview(assetId: string): Promise<MediaContentResponse>;
}

export class MediaContentService {
  constructor(private readonly content: MediaContentResolver, private readonly previews: ThumbnailResolver) {}

  thumbnail(assetId: string) { return this.previews.thumbnail(assetId); }
  preview(assetId: string) { return this.previews.preview(assetId); }
  original(assetId: string, range?: string) { return this.content.resolve({ assetId, variant: 'original', range }); }
  edited(assetId: string, range?: string) { return this.content.resolve({ assetId, variant: 'edited', range }); }
}
