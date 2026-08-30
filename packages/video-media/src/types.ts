export type VideoContainer = 'mp4'|'mov'|'mkv'|'webm'|'avi'|'unknown';
export type VideoCodec = 'h264'|'hevc'|'vp9'|'av1'|'mpeg4'|'unknown';
export type AudioCodec = 'aac'|'opus'|'mp3'|'pcm'|'unknown';

export interface VideoSource { uri:string; assetId?:string; mimeType?:string; sizeBytes?:number }
export interface VideoMetadata {
  durationMs:number;
  width:number;
  height:number;
  rotation?:number;
  fps?:number;
  bitrate?:number;
  container?:VideoContainer;
  videoCodec?:VideoCodec;
  audioCodec?:AudioCodec;
  hasAudio:boolean;
  sizeBytes?:number;
  createdAt?:string;
}
export interface VideoThumbnail { uri:string; width:number; height:number; timeMs:number; mimeType?:string }
export interface VideoPreview { uri:string; width?:number; height?:number; durationMs?:number; mimeType?:string }
export interface VideoProbeAdapter { probe(source:VideoSource):Promise<VideoMetadata> }
export interface VideoThumbnailAdapter { createThumbnail(source:VideoSource, options:{timeMs:number; maxWidth?:number; quality?:number}):Promise<VideoThumbnail> }
export interface VideoPreviewAdapter { createPreview?(source:VideoSource, options:{maxWidth?:number; maxDurationMs?:number; muted?:boolean}):Promise<VideoPreview> }
export interface VideoTranscodeAdapter { transcode?(source:VideoSource, options:{container?:'mp4'; videoCodec?:'h264'; audioCodec?:'aac'; maxWidth?:number; maxHeight?:number; bitrate?:number}):Promise<VideoPreview> }
export interface VideoPlaybackSource { uri:string; mimeType?:string; headers?:Record<string,string>; supportsRange:boolean; durationMs?:number; width?:number; height?:number }
export interface VideoPlaybackResolver { resolve(assetId:string):Promise<VideoPlaybackSource> }
export interface VideoMediaRecord { assetId:string; metadata:VideoMetadata; thumbnail?:VideoThumbnail; preview?:VideoPreview; updatedAt:string }
export interface VideoMediaRepository { get(assetId:string):Promise<VideoMediaRecord|null>; save(record:VideoMediaRecord):Promise<void>; remove(assetId:string):Promise<void> }
