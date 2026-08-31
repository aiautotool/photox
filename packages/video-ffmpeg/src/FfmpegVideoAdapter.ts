import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AudioCodec,
  VideoContainer,
  VideoMetadata,
  VideoPreview,
  VideoPreviewAdapter,
  VideoProbeAdapter,
  VideoSource,
  VideoThumbnail,
  VideoThumbnailAdapter,
  VideoTranscodeAdapter,
} from '@photox/video-media';

const execFileAsync = promisify(execFile);

export interface FfmpegVideoAdapterOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  outputDir: string;
  commandTimeoutMs?: number;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
  format?: ProbeFormat;
}

export class FfmpegVideoAdapter implements VideoProbeAdapter, VideoThumbnailAdapter, VideoPreviewAdapter, VideoTranscodeAdapter {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly outputDir: string;
  private readonly timeout: number;

  constructor(options: FfmpegVideoAdapterOptions) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.outputDir = options.outputDir;
    this.timeout = options.commandTimeoutMs ?? 120_000;
  }

  async probe(source: VideoSource): Promise<VideoMetadata> {
    const input = this.requireFileUri(source.uri);
    const { stdout } = await execFileAsync(this.ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      input,
    ], { timeout: this.timeout, maxBuffer: 4 * 1024 * 1024 });

    const payload = JSON.parse(stdout) as ProbePayload;
    const video = payload.streams?.find((stream) => stream.codec_type === 'video');
    if (!video) throw new Error(`No video stream found: ${input}`);
    const audio = payload.streams?.find((stream) => stream.codec_type === 'audio');
    const durationSeconds = this.number(video.duration) ?? this.number(payload.format?.duration) ?? 0;
    const rotation = video.side_data_list?.find((row) => typeof row.rotation === 'number')?.rotation
      ?? this.number(video.tags?.rotate);

    return {
      durationMs: Math.max(0, Math.round(durationSeconds * 1000)),
      width: video.width ?? 0,
      height: video.height ?? 0,
      rotation,
      fps: this.parseRate(video.avg_frame_rate ?? video.r_frame_rate),
      bitrate: this.number(video.bit_rate) ?? this.number(payload.format?.bit_rate),
      container: this.mapContainer(payload.format?.format_name, input),
      videoCodec: this.mapVideoCodec(video.codec_name),
      audioCodec: this.mapAudioCodec(audio?.codec_name),
      hasAudio: Boolean(audio),
      sizeBytes: this.number(payload.format?.size) ?? source.sizeBytes,
    };
  }

  async createThumbnail(source: VideoSource, options: { timeMs: number; maxWidth?: number; quality?: number }): Promise<VideoThumbnail> {
    await mkdir(this.outputDir, { recursive: true });
    const input = this.requireFileUri(source.uri);
    const filename = `${this.safeStem(source)}-${options.timeMs}.jpg`;
    const output = join(this.outputDir, filename);
    const vf = options.maxWidth ? `scale='min(${Math.max(1, Math.floor(options.maxWidth))},iw)':-2` : undefined;
    const args = ['-y', '-ss', this.seconds(options.timeMs), '-i', input, '-frames:v', '1'];
    if (vf) args.push('-vf', vf);
    args.push('-q:v', this.jpegQuality(options.quality), output);
    await execFileAsync(this.ffmpegPath, args, { timeout: this.timeout, maxBuffer: 2 * 1024 * 1024 });
    const meta = await this.probe(source);
    const width = options.maxWidth ? Math.min(meta.width, options.maxWidth) : meta.width;
    const height = meta.width > 0 ? Math.max(1, Math.round(meta.height * (width / meta.width))) : meta.height;
    return { uri: output, width, height, timeMs: options.timeMs, mimeType: 'image/jpeg' };
  }

  async createPreview(source: VideoSource, options: { maxWidth?: number; maxDurationMs?: number; muted?: boolean }): Promise<VideoPreview> {
    return this.renderMp4(source, {
      maxWidth: options.maxWidth,
      maxDurationMs: options.maxDurationMs,
      muted: options.muted ?? true,
      suffix: 'preview',
    });
  }

  async transcode(source: VideoSource, options: { container?: 'mp4'; videoCodec?: 'h264'; audioCodec?: 'aac'; maxWidth?: number; maxHeight?: number; bitrate?: number }): Promise<VideoPreview> {
    return this.renderMp4(source, {
      maxWidth: options.maxWidth,
      maxHeight: options.maxHeight,
      bitrate: options.bitrate,
      muted: false,
      suffix: 'playback',
    });
  }

  private async renderMp4(source: VideoSource, options: { maxWidth?: number; maxHeight?: number; maxDurationMs?: number; bitrate?: number; muted: boolean; suffix: string }): Promise<VideoPreview> {
    await mkdir(this.outputDir, { recursive: true });
    const input = this.requireFileUri(source.uri);
    const output = join(this.outputDir, `${this.safeStem(source)}-${options.suffix}.mp4`);
    const args = ['-y', '-i', input];
    if (options.maxDurationMs) args.push('-t', this.seconds(options.maxDurationMs));
    const filters: string[] = [];
    if (options.maxWidth || options.maxHeight) {
      const width = options.maxWidth ?? -2;
      const height = options.maxHeight ?? -2;
      filters.push(`scale='min(${width > 0 ? width : 100000},iw)':'min(${height > 0 ? height : 100000},ih)':force_original_aspect_ratio=decrease`);
    }
    if (filters.length) args.push('-vf', filters.join(','));
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-movflags', '+faststart', '-pix_fmt', 'yuv420p');
    if (options.bitrate) args.push('-b:v', String(Math.max(100_000, Math.floor(options.bitrate))));
    if (options.muted) args.push('-an');
    else args.push('-c:a', 'aac', '-b:a', '128k');
    args.push(output);
    await execFileAsync(this.ffmpegPath, args, { timeout: Math.max(this.timeout, 10 * 60_000), maxBuffer: 4 * 1024 * 1024 });
    const metadata = await this.probe({ uri: output, mimeType: 'video/mp4' });
    return { uri: output, width: metadata.width, height: metadata.height, durationMs: metadata.durationMs, mimeType: 'video/mp4' };
  }

  private requireFileUri(uri: string): string {
    if (/^https?:\/\//i.test(uri)) throw new Error('FfmpegVideoAdapter expects a local file path. Materialize/cache remote video before processing.');
    return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
  }

  private safeStem(source: VideoSource): string {
    const base = basename(this.requireFileUri(source.uri), extname(this.requireFileUri(source.uri)));
    return (source.assetId ?? base).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'video';
  }

  private seconds(ms: number): string { return (Math.max(0, ms) / 1000).toFixed(3); }
  private number(value: string | number | undefined): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  private parseRate(value?: string): number | undefined {
    if (!value) return undefined;
    const [a, b] = value.split('/').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return undefined;
    return a / b;
  }
  private jpegQuality(quality?: number): string {
    const normalized = Math.min(1, Math.max(0, quality ?? 0.82));
    return String(Math.max(2, Math.min(31, Math.round(31 - normalized * 29))));
  }
  private mapContainer(formatName: string | undefined, input: string): VideoContainer {
    const value = `${formatName ?? ''},${extname(input).slice(1)}`.toLowerCase();
    if (value.includes('mp4')) return 'mp4';
    if (value.includes('mov')) return 'mov';
    if (value.includes('matroska') || value.includes('mkv')) return 'mkv';
    if (value.includes('webm')) return 'webm';
    if (value.includes('avi')) return 'avi';
    return 'unknown';
  }
  private mapVideoCodec(codec?: string): VideoMetadata['videoCodec'] {
    switch ((codec ?? '').toLowerCase()) {
      case 'h264': return 'h264';
      case 'hevc': case 'h265': return 'hevc';
      case 'vp9': return 'vp9';
      case 'av1': return 'av1';
      case 'mpeg4': return 'mpeg4';
      default: return 'unknown';
    }
  }
  private mapAudioCodec(codec?: string): AudioCodec | undefined {
    if (!codec) return undefined;
    switch (codec.toLowerCase()) {
      case 'aac': return 'aac';
      case 'opus': return 'opus';
      case 'mp3': return 'mp3';
      case 'pcm_s16le': case 'pcm_s24le': case 'pcm_s32le': return 'pcm';
      default: return 'unknown';
    }
  }
}
