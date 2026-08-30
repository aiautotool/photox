import type { MediaCloudHealth } from '@photox/media-cloud';

export type MediaKind = 'photo' | 'video' | 'audio' | 'other';
export type MediaVariant = 'thumbnail' | 'preview' | 'original' | 'edited';

export interface MediaLocationDTO {
  providerId: string;
  accountId?: string;
  providerDisplayName?: string;
  accountDisplayName?: string;
  status: string;
  webViewLink?: string;
}

export interface MediaDTO {
  id: string;
  type: MediaKind;
  filename: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes?: number;
  createdAt?: string;
  modifiedAt?: string;
  favorite?: boolean;
  albumIds?: string[];
  thumbnail?: { url: string; width?: number; height?: number };
  preview?: { url: string };
  original: { url: string };
  cloud: {
    health: MediaCloudHealth;
    requiredReplicas: number;
    verifiedReplicas: number;
    locations: MediaLocationDTO[];
  };
  edit?: {
    edited: boolean;
    hasDraft?: boolean;
    editedAssetId?: string;
    recipeVersion?: number;
  };
  sync?: { state: string; lastSyncedAt?: string };
  video?: {
    durationMs?: number;
    width?: number;
    height?: number;
    fps?: number;
    codec?: string;
    bitrate?: number;
    playback: { url: string; supportsRange: boolean };
  };
}

export interface MediaListQuery {
  cursor?: string;
  limit?: number;
  type?: MediaKind;
  from?: string;
  to?: string;
  favorite?: boolean;
  albumId?: string;
  health?: MediaCloudHealth;
  providerId?: string;
  edited?: boolean;
  search?: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface MediaDetailSource {
  id: string;
  filename: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sizeBytes?: number;
  createdAt?: string;
  modifiedAt?: string;
  favorite?: boolean;
  albumIds?: string[];
  mediaType?: MediaKind;
  metadata?: Record<string, unknown>;
}

export interface MediaRepository {
  list(query: MediaListQuery & { after?: string }): Promise<{ items: MediaDetailSource[]; nextAfter?: string }>;
  get(id: string): Promise<MediaDetailSource | null>;
}

export interface MediaEditInfoProvider {
  get(id: string): Promise<MediaDTO['edit'] | undefined>;
}

export interface MediaSyncInfoProvider {
  get(id: string): Promise<MediaDTO['sync'] | undefined>;
}
