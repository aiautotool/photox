export type PlatformKind = 'desktop' | 'ios' | 'android';
export type ReleaseChannel = 'stable' | 'beta' | 'dev';
export type MediaType = 'photo' | 'video' | 'unknown';

export type MediaAsset = {
  key: string;
  assetId: string;
  deviceId?: string;
  filename: string;
  size: number;
  createdAt: number;
  receivedAt?: string;
  sha256?: string;
  mediaType: MediaType;
  localAvailable?: boolean;
  cloudAvailable?: boolean;
};

export type StorageAccount = {
  providerId: string;
  accountId: string;
  displayName: string;
  usedBytes?: number;
  freeBytes?: number;
  totalBytes?: number;
  status: 'ready' | 'unavailable' | 'full' | 'auth-required';
  metadata?: Record<string, string | number | boolean | null>;
};

export type StorageReplica = {
  providerId: string;
  accountId: string;
  state: 'QUEUED' | 'UPLOADING' | 'VERIFYING' | 'VERIFIED' | 'UPLOADED' | 'BLOCKED' | 'ERROR';
  remoteFileId?: string;
  remotePath?: string;
  webViewLink?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  message?: string;
};

export type StorageProviderDescriptor = {
  id: string;
  name: string;
  version: string;
  capabilities: Array<'upload' | 'download' | 'delete' | 'quota' | 'oauth' | 'share-link'>;
};

export type DesktopStatus = {
  name: string;
  version: string;
  apiVersion: string;
  received: number;
  libraryPath?: string;
  publicUrl?: string;
  tunnelHealthy?: boolean;
};

export type PairingCredentials = {
  baseUrl: string;
  pairCode: string;
  deviceId: string;
};

export type UpdateArtifact = {
  platform: PlatformKind;
  arch?: 'x64' | 'arm64' | 'universal';
  url: string;
  sha256: string;
  size?: number;
  signature?: string;
};

export type UpdateManifest = {
  schemaVersion: 1;
  appId: string;
  channel: ReleaseChannel;
  version: string;
  buildId: string;
  publishedAt: string;
  minimumSupportedVersion?: string;
  releaseNotes?: string;
  artifacts: UpdateArtifact[];
  metadata?: Record<string, string | number | boolean | null>;
};

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface HttpTransport {
  request(input: string, init?: RequestInit): Promise<Response>;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(v => Number(v.replace(/\D.*$/, '')) || 0);
  const pb = b.split('.').map(v => Number(v.replace(/\D.*$/, '')) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}
