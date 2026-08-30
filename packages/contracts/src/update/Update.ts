export type UpdateChannel = 'stable'|'beta'|'dev';
export type UpdatePlatform = 'windows'|'macos'|'android'|'ios';
export type UpdateArch = 'x64'|'arm64'|'universal';

export interface UpdateArtifact {
  platform: UpdatePlatform;
  arch?: UpdateArch;
  url: string;
  sha256: string;
  sizeBytes?: number;
  signature?: string;
}

export interface UpdateManifest {
  schemaVersion: 1;
  app: 'photox';
  version: string;
  buildId: string;
  channel: UpdateChannel;
  publishedAt: string;
  minimumSupportedVersion?: string;
  releaseNotes?: string;
  artifacts: UpdateArtifact[];
}
