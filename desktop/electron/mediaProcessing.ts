import path from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { FfmpegVideoAdapter } from '@photox/video-ffmpeg';
import type { VideoMetadata } from '@photox/video-media';

export type VideoProcessingResult = {
  width: number;
  height: number;
  duration: number;
  rotation?: number;
  fps?: number;
  bitrate?: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  thumbnailPath?: string;
  playbackPath?: string;
};

export type VideoProcessingPhase = 'probe' | 'thumbnail' | 'transcode';
export type VideoProcessingErrorCode = 'VIDEO_PROBE_FAILED' | 'VIDEO_THUMBNAIL_FAILED' | 'VIDEO_TRANSCODE_FAILED';

const ERROR_CODE_BY_PHASE: Record<VideoProcessingPhase, VideoProcessingErrorCode> = {
  probe: 'VIDEO_PROBE_FAILED',
  thumbnail: 'VIDEO_THUMBNAIL_FAILED',
  transcode: 'VIDEO_TRANSCODE_FAILED',
};

/**
 * Stable, renderer-safe processing error. Raw ffmpeg/ffprobe stderr can contain
 * local filesystem paths and command details, so callers should persist only
 * this message/code. The original cause stays non-enumerable in the main/server
 * process for diagnostics and cannot leak through ordinary JSON serialization.
 */
export class VideoProcessingError extends Error {
  readonly code: VideoProcessingErrorCode;
  readonly phase: VideoProcessingPhase;

  constructor(phase: VideoProcessingPhase, cause: unknown) {
    super(`Video processing failed during ${phase}.`);
    this.name = 'VideoProcessingError';
    this.code = ERROR_CODE_BY_PHASE[phase];
    this.phase = phase;
    Object.defineProperty(this, 'cause', {
      value: cause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

function unpacked(binaryPath: string) {
  return binaryPath.replace('app.asar', 'app.asar.unpacked');
}

export function mimeTypeForFilename(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.heic': return 'image/heic';
    case '.heif': return 'image/heif';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.tif': case '.tiff': return 'image/tiff';
    case '.dng': return 'image/x-adobe-dng';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    case '.m4v': return 'video/x-m4v';
    case '.webm': return 'video/webm';
    case '.mkv': return 'video/x-matroska';
    case '.avi': return 'video/x-msvideo';
    default: return 'application/octet-stream';
  }
}

export function isVideoFilename(filename: string) {
  return /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(filename);
}

/**
 * Desktop/Web playback is normalized to MP4/H.264/AAC. MOV containers, HEVC,
 * and any other non-compatible stream therefore get a generated playback copy
 * while the original media remains untouched.
 */
export function needsCompatibilityTranscode(metadata: VideoMetadata) {
  return metadata.container !== 'mp4'
    || metadata.videoCodec !== 'h264'
    || (metadata.hasAudio && metadata.audioCodec !== 'aac');
}

function processingError(phase: VideoProcessingPhase, cause: unknown): VideoProcessingError {
  return cause instanceof VideoProcessingError ? cause : new VideoProcessingError(phase, cause);
}

export async function processVideoFile(inputPath: string, assetKey: string, outputDir: string): Promise<VideoProcessingResult> {
  const adapter = new FfmpegVideoAdapter({
    ffmpegPath: unpacked(ffmpegInstaller.path),
    ffprobePath: unpacked(ffprobeInstaller.path),
    outputDir,
    commandTimeoutMs: 120_000,
  });
  const source = { uri: inputPath, assetId: assetKey, mimeType: mimeTypeForFilename(inputPath) };

  let metadata: VideoMetadata;
  try {
    metadata = await adapter.probe(source);
  } catch (error) {
    throw processingError('probe', error);
  }

  const safeThumbnailTime = Math.max(0, Math.min(1000, Math.floor(metadata.durationMs * 0.1), Math.max(0, metadata.durationMs - 1)));
  let thumbnail;
  try {
    thumbnail = await adapter.createThumbnail(source, { timeMs: safeThumbnailTime, maxWidth: 640, quality: 0.84 });
  } catch (error) {
    throw processingError('thumbnail', error);
  }

  let playbackPath: string | undefined;
  if (needsCompatibilityTranscode(metadata)) {
    try {
      const playback = await adapter.transcode(source, { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', maxWidth: 1920 });
      playbackPath = playback.uri;
    } catch (error) {
      throw processingError('transcode', error);
    }
  }
  return {
    width: metadata.width,
    height: metadata.height,
    duration: metadata.durationMs / 1000,
    rotation: metadata.rotation,
    fps: metadata.fps,
    bitrate: metadata.bitrate,
    container: metadata.container,
    videoCodec: metadata.videoCodec,
    audioCodec: metadata.audioCodec,
    hasAudio: metadata.hasAudio,
    thumbnailPath: thumbnail.uri,
    playbackPath,
  };
}
