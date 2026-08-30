import type { MediaAsset } from '@photox/contracts';

export type MediaPermission = 'granted' | 'denied' | 'limited';

export interface MediaSourceResolver {
  resolve(asset: MediaAsset): Promise<string>;
}

export interface MediaLibraryAdapter {
  requestPermission(): Promise<MediaPermission>;
  save(uri: string, options?: { album?: string; filename?: string }): Promise<{ assetId?: string; uri?: string }>;
  delete(assetIds: string[]): Promise<void>;
}

export interface MediaEditorAdapter {
  edit(input: {
    asset: MediaAsset;
    sourceUri: string;
    outputFilename?: string;
  }): Promise<{ uri: string; mimeType?: string; width?: number; height?: number } | null>;
}

export interface RemoteMediaDeleteAdapter {
  delete(asset: MediaAsset): Promise<void>;
}

export interface MediaActionsOptions {
  source: MediaSourceResolver;
  library: MediaLibraryAdapter;
  editor?: MediaEditorAdapter;
  remoteDelete?: RemoteMediaDeleteAdapter;
}

export interface DownloadMediaOptions {
  album?: string;
  filename?: string;
}

export interface DeleteMediaOptions {
  libraryAssetIds?: string[];
  deleteRemote?: boolean;
}

export interface EditMediaOptions {
  saveToLibrary?: boolean;
  album?: string;
  outputFilename?: string;
}

export class MediaActions {
  constructor(private readonly options: MediaActionsOptions) {}

  private async requireLibraryPermission(): Promise<void> {
    const permission = await this.options.library.requestPermission();
    if (permission === 'denied') throw new Error('MEDIA_LIBRARY_PERMISSION_DENIED');
  }

  async download(asset: MediaAsset, options: DownloadMediaOptions = {}): Promise<{ assetId?: string; uri?: string }> {
    await this.requireLibraryPermission();
    const uri = await this.options.source.resolve(asset);
    return this.options.library.save(uri, {
      album: options.album,
      filename: options.filename ?? asset.filename,
    });
  }

  async delete(asset: MediaAsset, options: DeleteMediaOptions = {}): Promise<void> {
    const ids = options.libraryAssetIds ?? [];
    if (ids.length > 0) {
      await this.requireLibraryPermission();
      await this.options.library.delete(ids);
    }
    if (options.deleteRemote) {
      if (!this.options.remoteDelete) throw new Error('REMOTE_DELETE_ADAPTER_NOT_CONFIGURED');
      await this.options.remoteDelete.delete(asset);
    }
  }

  async edit(asset: MediaAsset, options: EditMediaOptions = {}): Promise<{ uri: string; assetId?: string } | null> {
    if (!this.options.editor) throw new Error('MEDIA_EDITOR_ADAPTER_NOT_CONFIGURED');
    const sourceUri = await this.options.source.resolve(asset);
    const edited = await this.options.editor.edit({
      asset,
      sourceUri,
      outputFilename: options.outputFilename,
    });
    if (!edited) return null;

    if (options.saveToLibrary === false) return { uri: edited.uri };
    await this.requireLibraryPermission();
    const saved = await this.options.library.save(edited.uri, {
      album: options.album,
      filename: options.outputFilename,
    });
    return { uri: saved.uri ?? edited.uri, assetId: saved.assetId };
  }
}
