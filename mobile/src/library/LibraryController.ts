import * as MediaLibrary from 'expo-media-library/legacy';
import {
  addToAlbum,
  createAlbum,
  deleteAlbum,
  expiredTrashMediaIds,
  forgetMedia,
  loadLibraryState,
  moveToTrash,
  removeFromAlbum,
  renameAlbum,
  restoreFromTrash,
  saveLibraryState,
  setAlbumCover,
  setArchived,
  toggleFavorite,
  type MobileLibraryState,
} from './LibraryStateStore';

export type LibraryChangeListener = (state: MobileLibraryState) => void;

class MobileLibraryController {
  private state: MobileLibraryState | null = null;
  private listeners = new Set<LibraryChangeListener>();

  async initialize() {
    if (!this.state) this.state = await loadLibraryState();
    return this.snapshot();
  }

  snapshot(): MobileLibraryState {
    return this.state || { version: 1, favorites: [], archived: [], trash: [], albums: [] };
  }

  subscribe(listener: LibraryChangeListener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private async commit(next: MobileLibraryState) {
    this.state = next;
    await saveLibraryState(next);
    for (const listener of this.listeners) listener(this.snapshot());
    return this.snapshot();
  }

  async favorite(mediaId: string) {
    await this.initialize();
    return this.commit(toggleFavorite(this.snapshot(), mediaId));
  }

  async archive(mediaId: string, archived: boolean) {
    await this.initialize();
    return this.commit(setArchived(this.snapshot(), mediaId, archived));
  }

  async trash(mediaId: string) {
    await this.initialize();
    return this.commit(moveToTrash(this.snapshot(), mediaId));
  }

  async restore(mediaId: string) {
    await this.initialize();
    return this.commit(restoreFromTrash(this.snapshot(), mediaId));
  }

  async deletePermanently(asset: MediaLibrary.Asset) {
    await this.initialize();
    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
    if (!permission.granted) throw new Error('PHOTO_LIBRARY_DELETE_PERMISSION_DENIED');

    const deleted = await MediaLibrary.deleteAssetsAsync([asset]);
    if (!deleted) throw new Error('MEDIA_DELETE_FAILED');
    return this.commit(forgetMedia(this.snapshot(), asset.id));
  }

  async emptyTrash(resolveAsset: (mediaId: string) => MediaLibrary.Asset | undefined) {
    await this.initialize();
    const trashed = this.snapshot().trash.map(entry => entry.mediaId);
    if (!trashed.length) return { deleted: 0, failed: [] as string[] };

    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
    if (!permission.granted) throw new Error('PHOTO_LIBRARY_DELETE_PERMISSION_DENIED');

    let state = this.snapshot();
    let deleted = 0;
    const failed: string[] = [];
    for (const mediaId of trashed) {
      const asset = resolveAsset(mediaId);
      if (!asset) {
        state = forgetMedia(state, mediaId);
        continue;
      }
      try {
        const ok = await MediaLibrary.deleteAssetsAsync([asset]);
        if (!ok) throw new Error('delete returned false');
        state = forgetMedia(state, mediaId);
        deleted += 1;
      } catch {
        failed.push(mediaId);
      }
    }
    await this.commit(state);
    return { deleted, failed };
  }

  async purgeExpiredTrash(
    resolveAsset: (mediaId: string) => MediaLibrary.Asset | undefined,
    retentionDays = 30,
  ) {
    await this.initialize();
    const expired = expiredTrashMediaIds(this.snapshot(), retentionDays);
    if (!expired.length) return { deleted: 0, failed: [] as string[] };

    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
    if (!permission.granted) return { deleted: 0, failed: expired };

    let state = this.snapshot();
    let deleted = 0;
    const failed: string[] = [];
    for (const mediaId of expired) {
      const asset = resolveAsset(mediaId);
      if (!asset) {
        state = forgetMedia(state, mediaId);
        continue;
      }
      try {
        const ok = await MediaLibrary.deleteAssetsAsync([asset]);
        if (!ok) throw new Error('delete returned false');
        state = forgetMedia(state, mediaId);
        deleted += 1;
      } catch {
        failed.push(mediaId);
      }
    }
    await this.commit(state);
    return { deleted, failed };
  }

  async createAlbum(name: string, mediaIds: string[] = []) {
    await this.initialize();
    return this.commit(createAlbum(this.snapshot(), name, mediaIds));
  }

  async renameAlbum(albumId: string, name: string) {
    await this.initialize();
    return this.commit(renameAlbum(this.snapshot(), albumId, name));
  }

  async deleteAlbum(albumId: string) {
    await this.initialize();
    return this.commit(deleteAlbum(this.snapshot(), albumId));
  }

  async addToAlbum(albumId: string, mediaIds: string[]) {
    await this.initialize();
    return this.commit(addToAlbum(this.snapshot(), albumId, mediaIds));
  }

  async removeFromAlbum(albumId: string, mediaIds: string[]) {
    await this.initialize();
    return this.commit(removeFromAlbum(this.snapshot(), albumId, mediaIds));
  }

  async setAlbumCover(albumId: string, mediaId: string) {
    await this.initialize();
    return this.commit(setAlbumCover(this.snapshot(), albumId, mediaId));
  }
}

export const mobileLibraryController = new MobileLibraryController();
