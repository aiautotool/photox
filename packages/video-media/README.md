# @photox/video-media

Platform-neutral video processing contracts for PhotoX. This package does not depend on Expo, Electron, ffmpeg, AVFoundation, MediaCodec, or a specific player.

## Responsibilities

- probe duration, dimensions, rotation, FPS, bitrate, container, video/audio codec
- generate thumbnail/poster at a safe timestamp
- optionally generate a short preview
- optionally transcode incompatible sources to a widely playable MP4/H.264/AAC derivative
- persist normalized video metadata
- resolve/rank playback sources, preferring local + HTTP Range capable sources

## Processing pipeline

```text
Video received/imported
  -> VideoProbeAdapter.probe
  -> VideoThumbnailAdapter.createThumbnail
  -> optional preview/transcode
  -> VideoMediaRepository.save
```

The original is never overwritten by transcoding. Any playable derivative is a cache/variant.

## Platform adapters to implement later

Desktop/Electron can use an ffprobe/ffmpeg-backed adapter or another native media engine. Mobile can inject native/Expo-compatible metadata, thumbnail and playback adapters. Keep these dependencies outside this core package.

## Playback

`PlaybackPolicy` ranks healthy candidates. Local sources are preferred, then sources supporting HTTP Range, then broadly playable MP4 sources and lower-latency candidates.

For remote video, the Desktop Media API should proxy/resolve content and forward the Range header so the player can seek without downloading the whole video.

## Persistence

Production should implement `VideoMediaRepository`, e.g. a `video_media` table keyed by `assetId`. The in-memory repository is only for development/tests.
