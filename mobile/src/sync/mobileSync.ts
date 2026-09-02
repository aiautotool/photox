import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import { File as ExpoFile } from 'expo-file-system';
import type { PairedDesktop } from './pairing';
import { clearAssetFailed, markAssetFailed, markAssetSynced } from './syncLedger';

declare const require: (id: string) => any;

export type MediaAsset = MediaLibrary.Asset;
export type DisplayAsset = MediaAsset & {
  cloudOnly?: boolean;
  requestHeaders?: Record<string, string>;
  fileSize?: number;
  mimeType?: string;
  thumbnailUri?: string;
  playbackUri?: string;
  rotation?: number;
  fps?: number;
  bitrate?: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  videoProcessing?: 'queued'|'processing'|'ready'|'error';
  videoError?: string;
};
export type AssetMetadata = {
  make?: string; model?: string; lens?: string; software?: string;
  focalLength?: number; focalLength35mm?: number; aperture?: number;
  exposureTime?: number; iso?: number; flash?: string;
  latitude?: number; longitude?: number; capturedAt?: Date; fileSize?: number;
};

function loadExifr() {
  const runtimeNavigator = globalThis.navigator as Navigator & { userAgent?: string };
  if (runtimeNavigator && !runtimeNavigator.userAgent) {
    Object.defineProperty(runtimeNavigator, 'userAgent', {
      configurable: true,
      value: 'PhotoSync React Native iOS',
    });
  }
  const module = require('exifr/dist/lite.umd.cjs');
  return module.default || module;
}

export async function loadAssetMetadata(asset: DisplayAsset): Promise<AssetMetadata> {
  if (asset.mediaType === 'video') return { fileSize: asset.fileSize };
  let buffer: ArrayBuffer;
  let fileSize = asset.fileSize;
  if (asset.cloudOnly) {
    const response = await fetch(asset.uri, { headers: asset.requestHeaders });
    if (!response.ok) throw new Error(`Không đọc được metadata (${response.status})`);
    buffer = await response.arrayBuffer();
  } else {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
    const file = new ExpoFile(info.localUri || info.uri || asset.uri);
    fileSize = file.size;
    buffer = await file.arrayBuffer();
  }
  const data = await loadExifr().parse(buffer, {
    tiff: true, exif: true, gps: true, xmp: true, translateValues: true,
    pick: ['Make','Model','LensModel','Software','FocalLength','FocalLengthIn35mmFormat','FNumber','ExposureTime','ISO','Flash','latitude','longitude','DateTimeOriginal','CreateDate'],
  }) || {};
  return {
    make: data.Make, model: data.Model, lens: data.LensModel, software: data.Software,
    focalLength: data.FocalLength, focalLength35mm: data.FocalLengthIn35mmFormat,
    aperture: data.FNumber, exposureTime: data.ExposureTime, iso: data.ISO,
    flash: typeof data.Flash === 'string' ? data.Flash : undefined,
    latitude: data.latitude, longitude: data.longitude,
    capturedAt: data.DateTimeOriginal || data.CreateDate, fileSize,
  };
}

export async function prepareAssetForEditing(asset: DisplayAsset): Promise<string> {
  if (asset.mediaType === 'video') throw new Error('Trình chỉnh sửa ảnh không hỗ trợ video.');
  if (!asset.cloudOnly) {
    const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
    return info.localUri || info.uri || asset.uri;
  }
  const extension = asset.filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
  const destination = `${FileSystem.cacheDirectory}photosync-editor-${Date.now()}.${extension}`;
  return (await FileSystem.downloadAsync(asset.uri, destination, { headers: asset.requestHeaders })).uri;
}

/** Downloads the original cloud asset and stores a copy in the device photo library. */
export async function downloadCloudAsset(asset: DisplayAsset): Promise<MediaAsset> {
  if (!asset.cloudOnly) throw new Error('Mục này đã có trên thiết bị.');

  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo', 'video']);
  if (!permission.granted) throw new Error('Bạn chưa cấp quyền lưu ảnh vào thư viện.');

  const extension = asset.filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || (asset.mediaType === 'video' ? 'mp4' : 'jpg');
  const destination = `${FileSystem.cacheDirectory}photosync-download-${Date.now()}.${extension}`;
  const originalUri = asset.playbackUri && asset.uri === asset.playbackUri
    ? asset.uri.replace('/api/v1/playback/', '/api/v1/media/')
    : asset.uri;
  try {
    const downloaded = await FileSystem.downloadAsync(originalUri, destination, { headers: asset.requestHeaders });
    return await MediaLibrary.createAssetAsync(downloaded.uri);
  } finally {
    await FileSystem.deleteAsync(destination, { idempotent: true }).catch(() => undefined);
  }
}

export type SyncProgress = {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  current?: string;
  currentAssetId?: string;
  currentBytesUploaded?: number;
  currentBytesTotal?: number;
  currentBytesRemaining?: number;
  lastError?: string;
};

export async function requestPhotoLibrary() {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  if (!permission.granted) throw new Error('Bạn chưa cấp quyền truy cập thư viện ảnh.');
  return permission;
}

export async function loadDevicePhotos(limit = 300): Promise<MediaAsset[]> {
  await requestPhotoLibrary();
  const result = await MediaLibrary.getAssetsAsync({
    first: limit,
    mediaType: ['photo', 'video'],
    sortBy: [['creationTime', false]] as any,
  });
  return result.assets;
}

export function mimeForFilename(filename: string, mediaType?: MediaAsset['mediaType']): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'tif': case 'tiff': return 'image/tiff';
    case 'dng': return 'image/x-adobe-dng';
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'm4v': return 'video/x-m4v';
    case 'webm': return 'video/webm';
    case 'mkv': return 'video/x-matroska';
    case 'avi': return 'video/x-msvideo';
    default: return mediaType === 'video' ? 'application/octet-stream' : 'image/jpeg';
  }
}

function mimeFor(asset: MediaAsset): string { return mimeForFilename(asset.filename, asset.mediaType); }

async function materializeAsset(asset: MediaAsset): Promise<{ uri: string; size: number; temporary: boolean }> {
  const info = await MediaLibrary.getAssetInfoAsync(asset, { shouldDownloadFromNetwork: true });
  const originalUri = info.localUri || info.uri || asset.uri;
  const cacheDir = `${FileSystem.cacheDirectory}photosync-send/`;
  await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
  const safeName = asset.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const uri = `${cacheDir}${asset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}-${safeName}`;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  try {
    await FileSystem.copyAsync({ from: originalUri, to: uri });
  } catch (error) {
    throw new Error(`iOS không xuất được file gốc ${asset.filename}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const fsInfo = await FileSystem.getInfoAsync(uri);
  if (!fsInfo.exists || typeof fsInfo.size !== 'number') throw new Error(`Không đọc được ${asset.filename}`);
  return { uri, size: fsInfo.size, temporary: true };
}

function relayEndpoint(target: PairedDesktop, path: string) {
  return `${target.relayUrl.replace(/\/$/, '')}${path}`;
}

function localEndpoint(target: PairedDesktop, path: string) {
  return `${target.receiverUrl!.replace(/\/$/, '')}${path}`;
}

function publicEndpoint(target: PairedDesktop, path: string) {
  const base = target.publicUrl || (/photox\.aiautotool\.com/i.test(target.relayUrl) ? target.relayUrl : undefined);
  return base ? `${base.replace(/\/$/, '')}${path}` : undefined;
}

export async function loadCloudPhotos(target: PairedDesktop): Promise<DisplayAsset[]> {
  const endpoint = publicEndpoint(target, '/api/v1/library');
  if (!endpoint || !target.pairCode) return [];
  const response = await fetchWithTimeout(endpoint, { headers: { 'x-photosync-pair-code': target.pairCode } }, 15_000);
  if (!response.ok) throw new Error(`Cloud library ${response.status}`);
  const items = await response.json() as Array<{
    key:string;assetId:string;filename:string;size:number;createdAt:number;mediaType:'photo'|'video';
    mimeType?:string;width?:number;height?:number;duration?:number;rotation?:number;fps?:number;bitrate?:number;
    container?:string;videoCodec?:string;audioCodec?:string;videoProcessing?:DisplayAsset['videoProcessing'];videoError?:string;
    thumbnailAvailable?:boolean;playbackAvailable?:boolean;
  }>;
  return items.map((item) => {
    const mediaUri = publicEndpoint(target, `/api/v1/media/${encodeURIComponent(item.key)}`)!;
    const playbackUri = item.mediaType === 'video' && item.playbackAvailable
      ? publicEndpoint(target, `/api/v1/playback/${encodeURIComponent(item.key)}`)!
      : undefined;
    const thumbnailUri = item.mediaType === 'video' && item.thumbnailAvailable
      ? publicEndpoint(target, `/api/v1/thumbnail/${encodeURIComponent(item.key)}`)!
      : undefined;
    return {
      id: item.assetId || item.key,
      filename: item.filename,
      uri: playbackUri || mediaUri,
      mediaType: item.mediaType,
      mediaSubtypes: [],
      width: item.width || 0,
      height: item.height || 0,
      creationTime: item.createdAt,
      modificationTime: item.createdAt,
      duration: item.duration || 0,
      fileSize: item.size,
      albumId: 'photosync-cloud',
      cloudOnly: true,
      mimeType: item.mimeType || mimeForFilename(item.filename, item.mediaType),
      thumbnailUri,
      playbackUri,
      rotation: item.rotation,
      fps: item.fps,
      bitrate: item.bitrate,
      container: item.container,
      videoCodec: item.videoCodec,
      audioCodec: item.audioCodec,
      videoProcessing: item.videoProcessing,
      videoError: item.videoError,
      requestHeaders: { 'x-photosync-pair-code': target.pairCode! },
    } as DisplayAsset;
  });
}

async function fetchWithTimeout(url:string, init:RequestInit = {}, timeoutMs = 8_000, externalSignal?:AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once:true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
}

export async function pingLaptop(target: PairedDesktop, signal?:AbortSignal) {
  const publicUrl = publicEndpoint(target, '/api/v1/status');
  if (publicUrl && target.pairCode) {
    try {
      const response = await fetchWithTimeout(publicUrl, { headers: { 'x-photosync-pair-code': target.pairCode } }, 8_000, signal);
      if (response.ok) return { online: true, transport: 'public' as const };
    } catch {}
  }
  if (target.receiverUrl && target.pairCode) {
    try {
      const response = await fetchWithTimeout(localEndpoint(target, '/api/v1/status'), {
        headers: { 'x-photosync-pair-code': target.pairCode },
      }, 1_500, signal);
      if (response.ok) return { online: true, transport: 'local' as const };
    } catch {}
  }

  try {
    const response = await fetchWithTimeout(relayEndpoint(target, `/api/v1/desktop/${encodeURIComponent(target.desktopId)}/status`), {}, 8_000, signal);
    if (!response.ok) throw new Error(`Relay trả lỗi ${response.status}`);
    const data = await response.json() as { online: boolean };
    if (!data.online) throw new Error('Laptop đang offline');
    return { ...data, transport: 'relay' as const };
  } catch (error) {
    if (!target.receiverUrl) throw new Error('QR ghép nối cũ không có địa chỉ LAN. Hãy quên máy tính và quét lại QR mới trên laptop.');
    throw error;
  }
}

export async function syncAssetsToLaptop(
  target: PairedDesktop,
  assets: MediaAsset[],
  onProgress?: (progress: SyncProgress) => void,
  signal?: AbortSignal,
): Promise<SyncProgress> {
  const connection = await pingLaptop(target, signal);
  const progress: SyncProgress = { total: assets.length, completed: 0, skipped: 0, failed: 0 };

  for (const asset of [...assets].reverse()) {
    if (signal?.aborted) throw new Error('Đã dừng đồng bộ');
    progress.current = asset.filename;
    progress.currentAssetId = asset.id;
    progress.currentBytesUploaded = undefined;
    progress.currentBytesTotal = undefined;
    progress.currentBytesRemaining = undefined;
    onProgress?.({ ...progress });
    let local: Awaited<ReturnType<typeof materializeAsset>> | null = null;
    try {
      local = await materializeAsset(asset);
      progress.currentBytesUploaded = 0;
      progress.currentBytesTotal = local.size;
      progress.currentBytesRemaining = local.size;
      onProgress?.({ ...progress });
      const upload = async (transport: 'local'|'public'|'relay') => {
        progress.currentBytesUploaded = 0;
        progress.currentBytesTotal = local!.size;
        progress.currentBytesRemaining = local!.size;
        onProgress?.({ ...progress });
        const task = FileSystem.createUploadTask(transport === 'local'
          ? localEndpoint(target, '/api/v1/media')
          : transport === 'public'
            ? publicEndpoint(target, '/api/v1/media')!
            : relayEndpoint(target, `/api/v1/upload/${encodeURIComponent(target.desktopId)}`), local!.uri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
          headers: {
            'content-type': mimeFor(asset),
            ...(transport !== 'relay'
              ? { 'x-photosync-pair-code': target.pairCode! }
              : { 'x-photosync-pair-token': target.pairToken }),
            'x-photosync-device-id': target.deviceId,
            'x-photosync-asset-id': asset.id,
            'x-photosync-filename': encodeURIComponent(asset.filename),
            'x-photosync-created-at': String(asset.creationTime),
            'x-photosync-media-type': asset.mediaType,
          },
        }, ({ totalBytesSent, totalBytesExpectedToSend }) => {
          const total = totalBytesExpectedToSend > 0 ? totalBytesExpectedToSend : local!.size;
          const uploaded = Math.min(totalBytesSent, total);
          progress.currentBytesUploaded = uploaded;
          progress.currentBytesTotal = total;
          progress.currentBytesRemaining = Math.max(total - uploaded, 0);
          onProgress?.({ ...progress });
        });
        const result = await task.uploadAsync();
        if (!result) throw new Error('Tác vụ tải lên đã bị hủy');
        return result;
      };
      let result;
      if (connection.transport === 'public') {
        result = await upload('public');
      } else if (connection.transport === 'local') {
        try {
          result = await upload('local');
          if (result.status < 200 || result.status >= 300) throw new Error(`LAN ${result.status}: ${result.body}`);
        } catch (error) {
          if (signal?.aborted) throw error;
          result = await upload('relay');
        }
      } else {
        result = await upload('relay');
      }
      if (result.status === 208) progress.skipped += 1;
      else if (result.status >= 200 && result.status < 300) progress.completed += 1;
      else if (result.status === 503) throw new Error('Laptop đang offline');
      else throw new Error(`Tunnel ${result.status}: ${result.body}`);
      await markAssetSynced(asset.id);
      await clearAssetFailed(asset.id);
    } catch (error) {
      if (signal?.aborted) throw error;
      progress.failed += 1;
      progress.lastError = `${asset.filename}: ${error instanceof Error ? error.message : String(error)}`;
      await markAssetFailed(asset.id, progress.lastError);
    } finally {
      if (local?.temporary) await FileSystem.deleteAsync(local.uri, { idempotent: true }).catch(() => undefined);
      onProgress?.({ ...progress });
    }
  }

  progress.current = undefined;
  progress.currentAssetId = undefined;
  progress.currentBytesUploaded = undefined;
  progress.currentBytesTotal = undefined;
  progress.currentBytesRemaining = undefined;
  onProgress?.({ ...progress });
  return progress;
}
