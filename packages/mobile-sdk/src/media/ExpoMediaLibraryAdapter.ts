import type { MediaLibraryAdapter, MediaPermission } from './MediaActions';

export interface ExpoMediaLibraryModule {
  requestPermissionsAsync(writeOnly?: boolean): Promise<{ status: string; accessPrivileges?: string | null }>;
  createAssetAsync(uri: string): Promise<{ id: string; uri: string }>;
  createAlbumAsync?(albumName: string, asset: { id: string }, copyAsset?: boolean): Promise<unknown>;
  deleteAssetsAsync(assetIds: string[]): Promise<boolean>;
}

export class ExpoMediaLibraryAdapter implements MediaLibraryAdapter {
  constructor(private readonly mediaLibrary: ExpoMediaLibraryModule) {}

  async requestPermission(): Promise<MediaPermission> {
    const result = await this.mediaLibrary.requestPermissionsAsync(false);
    if (result.status !== 'granted') return 'denied';
    if (result.accessPrivileges === 'limited') return 'limited';
    return 'granted';
  }

  async save(uri: string, options: { album?: string } = {}): Promise<{ assetId?: string; uri?: string }> {
    const asset = await this.mediaLibrary.createAssetAsync(uri);
    if (options.album && this.mediaLibrary.createAlbumAsync) {
      await this.mediaLibrary.createAlbumAsync(options.album, asset, false);
    }
    return { assetId: asset.id, uri: asset.uri };
  }

  async delete(assetIds: string[]): Promise<void> {
    const ok = await this.mediaLibrary.deleteAssetsAsync(assetIds);
    if (!ok) throw new Error('MEDIA_LIBRARY_DELETE_REJECTED');
  }
}
