import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { VideoMetadata } from '@photox/video-media';
import {
  VideoProcessingError,
  isVideoFilename,
  mimeTypeForFilename,
  needsCompatibilityTranscode,
  processVideoFile,
} from './mediaProcessing.js';

function metadata(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    durationMs: 1_000,
    width: 1920,
    height: 1080,
    container: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    hasAudio: true,
    ...overrides,
  };
}

test('MOV input is recognized and requires a compatibility playback copy', () => {
  assert.equal(isVideoFilename('IMG_1234.MOV'), true);
  assert.equal(mimeTypeForFilename('IMG_1234.MOV'), 'video/quicktime');
  assert.equal(needsCompatibilityTranscode(metadata({ container: 'mov' })), true);
});

test('HEVC input requires H.264 compatibility transcoding even inside MP4', () => {
  assert.equal(needsCompatibilityTranscode(metadata({ videoCodec: 'hevc' })), true);
  assert.equal(needsCompatibilityTranscode(metadata({ container: 'mov', videoCodec: 'hevc' })), true);
});

test('native MP4 H.264 AAC playback does not create an unnecessary compatibility copy', () => {
  assert.equal(needsCompatibilityTranscode(metadata()), false);
  assert.equal(needsCompatibilityTranscode(metadata({ hasAudio: false, audioCodec: undefined })), false);
});

test('non-AAC audio requires compatibility transcoding when audio is present', () => {
  assert.equal(needsCompatibilityTranscode(metadata({ audioCodec: 'pcm' })), true);
  assert.equal(needsCompatibilityTranscode(metadata({ hasAudio: false, audioCodec: 'pcm' })), false);
});

test('corrupt MOV fails closed with a stable probe error and does not expose the local path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'photox-corrupt-video-'));
  const inputPath = join(dir, 'private-camera-roll.MOV');
  const outputDir = join(dir, 'processed');
  await writeFile(inputPath, Buffer.from('this is deliberately not a video'));

  try {
    await assert.rejects(
      processVideoFile(inputPath, 'corrupt-asset', outputDir),
      (error: unknown) => {
        assert.ok(error instanceof VideoProcessingError);
        assert.equal(error.code, 'VIDEO_PROBE_FAILED');
        assert.equal(error.phase, 'probe');
        assert.equal(error.message, 'Video processing failed during probe.');
        assert.equal(error.message.includes(inputPath), false);
        assert.equal(error.message.includes('private-camera-roll.MOV'), false);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
