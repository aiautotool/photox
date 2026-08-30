import type { MediaCloudCatalog } from '@photox/media-cloud';
import type { CursorPage, MediaDTO, MediaDetailSource, MediaEditInfoProvider, MediaListQuery, MediaRepository, MediaSyncInfoProvider } from './types';

export interface MediaUrlFactory {
  thumbnail(id: string): string;
  preview(id: string): string;
  content(id: string, variant?: 'original' | 'edited'): string;
}

export class MediaViewService {
  constructor(
    private readonly media: MediaRepository,
    private readonly cloud: MediaCloudCatalog,
    private readonly urls: MediaUrlFactory,
    private readonly edits?: MediaEditInfoProvider,
    private readonly sync?: MediaSyncInfoProvider,
  ) {}

  async get(id: string): Promise<MediaDTO | null> {
    const source = await this.media.get(id);
    return source ? this.map(source) : null;
  }

  async list(query: MediaListQuery = {}): Promise<CursorPage<MediaDTO>> {
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const result = await this.media.list({ ...query, limit, after: query.cursor });
    const items = await Promise.all(result.items.map((item) => this.map(item)));
    return { items, nextCursor: result.nextAfter, hasMore: Boolean(result.nextAfter) };
  }

  private async map(source: MediaDetailSource): Promise<MediaDTO> {
    const cloud = await this.cloud.get(source.id);
    const type = source.mediaType ?? inferKind(source.mimeType);
    const edit = this.edits ? await this.edits.get(source.id) : undefined;
    const sync = this.sync ? await this.sync.get(source.id) : undefined;
    const locations = cloud?.locations.map((row) => ({
      providerId: row.providerId,
      accountId: row.accountId,
      providerDisplayName: row.providerDisplayName,
      accountDisplayName: row.accountDisplayName,
      status: row.state,
      webViewLink: row.webViewLink,
    })) ?? [];

    return {
      id: source.id,
      type,
      filename: source.filename,
      mimeType: source.mimeType,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      sizeBytes: source.sizeBytes,
      createdAt: source.createdAt,
      modifiedAt: source.modifiedAt,
      favorite: source.favorite,
      albumIds: source.albumIds,
      thumbnail: { url: this.urls.thumbnail(source.id) },
      preview: { url: this.urls.preview(source.id) },
      original: { url: this.urls.content(source.id, 'original') },
      cloud: {
        health: cloud?.health ?? 'unknown',
        requiredReplicas: cloud?.targetReplicas ?? 0,
        verifiedReplicas: cloud?.verifiedReplicas ?? 0,
        locations,
      },
      edit,
      sync,
      video: type === 'video' ? {
        durationMs: source.durationMs,
        width: source.width,
        height: source.height,
        fps: numberMeta(source.metadata?.fps),
        codec: stringMeta(source.metadata?.codec),
        bitrate: numberMeta(source.metadata?.bitrate),
        playback: { url: this.urls.content(source.id, edit?.edited ? 'edited' : 'original'), supportsRange: true },
      } : undefined,
    };
  }
}

function inferKind(mime?: string): MediaDTO['type'] {
  if (mime?.startsWith('image/')) return 'photo';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  return 'other';
}
function numberMeta(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
function stringMeta(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
