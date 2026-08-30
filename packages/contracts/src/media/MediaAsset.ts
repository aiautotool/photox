import type { StorageReplica } from '../storage/StorageProvider';

export type MediaType = 'image' | 'video' | 'live-photo' | 'unknown';

export interface MediaMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
  takenAt?: string;
  latitude?: number;
  longitude?: number;
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  raw?: Record<string, unknown>;
}

export interface MediaAsset {
  id: string;
  deviceId: string;
  filename: string;
  mimeType: string;
  type: MediaType;
  sizeBytes: number;
  sha256?: string;
  localUri?: string;
  createdAt: string;
  modifiedAt?: string;
  metadata?: MediaMetadata;
  replicas?: StorageReplica[];
}
