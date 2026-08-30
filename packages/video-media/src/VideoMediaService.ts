import type { VideoMediaRecord, VideoMediaRepository, VideoPreviewAdapter, VideoProbeAdapter, VideoSource, VideoThumbnailAdapter, VideoTranscodeAdapter } from './types';

export interface ProcessVideoOptions {
  thumbnailTimeMs?: number;
  thumbnailMaxWidth?: number;
  thumbnailQuality?: number;
  createPreview?: boolean;
  previewMaxWidth?: number;
  previewMaxDurationMs?: number;
  ensurePlayableMp4?: boolean;
}

export class VideoMediaService {
  constructor(
    private readonly probe: VideoProbeAdapter,
    private readonly thumbnail: VideoThumbnailAdapter,
    private readonly repository: VideoMediaRepository,
    private readonly preview?: VideoPreviewAdapter,
    private readonly transcode?: VideoTranscodeAdapter,
  ) {}

  async process(assetId:string, source:VideoSource, options:ProcessVideoOptions = {}):Promise<VideoMediaRecord> {
    const metadata = await this.probe.probe(source);
    const safeTime = Math.max(0, Math.min(options.thumbnailTimeMs ?? Math.min(1000, Math.floor(metadata.durationMs * 0.1)), Math.max(0, metadata.durationMs - 1)));
    const thumbnail = await this.thumbnail.createThumbnail(source, {
      timeMs: safeTime,
      maxWidth: options.thumbnailMaxWidth ?? 640,
      quality: options.thumbnailQuality ?? 0.82,
    });

    let preview;
    if (options.createPreview && this.preview?.createPreview) {
      preview = await this.preview.createPreview(source, {
        maxWidth: options.previewMaxWidth ?? 1280,
        maxDurationMs: options.previewMaxDurationMs ?? 15000,
        muted: true,
      });
    }

    if (options.ensurePlayableMp4 && !this.isWidelyPlayable(metadata) && this.transcode?.transcode) {
      preview = await this.transcode.transcode(source, { container:'mp4', videoCodec:'h264', audioCodec:'aac', maxWidth:1920 });
    }

    const record:VideoMediaRecord = { assetId, metadata, thumbnail, preview, updatedAt:new Date().toISOString() };
    await this.repository.save(record);
    return record;
  }

  async get(assetId:string){ return this.repository.get(assetId); }

  isWidelyPlayable(metadata:VideoMediaRecord['metadata']):boolean {
    const videoOk = metadata.videoCodec === 'h264' || metadata.videoCodec === 'hevc';
    const audioOk = !metadata.hasAudio || metadata.audioCodec === 'aac';
    return videoOk && audioOk;
  }
}
