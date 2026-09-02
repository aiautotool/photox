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

function needsCompatibilityTranscode(metadata: VideoMetadata) {
  return metadata.container !== 'mp4'
    || metadata.videoCodec !== 'h264'
    || (metadata.hasAudio && metadata.audioCodec !== 'aac');
}

export async function processVideoFile(inputPath: string, assetKey: string, outputDir: string): Promise<VideoProcessingResult> {
  const adapter = new FfmpegVideoAdapter({
    ffmpegPath: unpacked(ffmpegInstaller.path),
    ffprobePath: unpacked(ffprobeInstaller.path),
    outputDir,
    commandTimeoutMs: 120_000,
  });
  const source = { uri: inputPath, assetId: assetKey, mimeType: mimeTypeForFilename(inputPath) };
  const metadata = await adapter.probe(source);
  const safeThumbnailTime = Math.max(0, Math.min(1000, Math.floor(metadata.durationMs * 0.1), Math.max(0, metadata.durationMs - 1)));
  const thumbnail = await adapter.createThumbnail(source, { timeMs: safeThumbnailTime, maxWidth: 640, quality: 0.84 });
  let playbackPath: string | undefined;
  if (needsCompatibilityTranscode(metadata)) {
    const playback = await adapter.transcode(source, { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', maxWidth: 1920 });
    playbackPath = playback.uri;
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
