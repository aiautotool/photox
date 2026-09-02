export const GOOGLE_PHOTOS_PICKER_SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
export const GOOGLE_PHOTOS_APPEND_SCOPE = 'https://www.googleapis.com/auth/photoslibrary.appendonly';

export type PickingSession = {
  id: string;
  pickerUri?: string;
  expireTime?: string;
  mediaItemsSet?: boolean;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
};

export type PickedMediaItem = {
  id: string;
  createTime?: string;
  type?: string;
  mediaFile?: {
    baseUrl: string;
    mimeType?: string;
    filename?: string;
    mediaFileMetadata?: { width?: number; height?: number; cameraMake?: string; cameraModel?: string };
  };
};

export type PickedMediaPage = { mediaItems?: PickedMediaItem[]; nextPageToken?: string };

async function googleJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Google Photos ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function createPickingSession(accessToken: string, maxItemCount = 2000): Promise<PickingSession> {
  const bounded = Math.max(1, Math.min(2000, Math.floor(maxItemCount)));
  return googleJson<PickingSession>('https://photospicker.googleapis.com/v1/sessions', accessToken, {
    method: 'POST',
    body: JSON.stringify({ pickingConfig: { maxItemCount: String(bounded) } }),
  });
}

export function getPickingSession(accessToken: string, sessionId: string): Promise<PickingSession> {
  return googleJson<PickingSession>(`https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(sessionId)}`, accessToken);
}

export async function deletePickingSession(accessToken: string, sessionId: string): Promise<void> {
  await googleJson<void>(`https://photospicker.googleapis.com/v1/sessions/${encodeURIComponent(sessionId)}`, accessToken, { method: 'DELETE' });
}

export function listPickedMedia(
  accessToken: string,
  sessionId: string,
  options: { pageSize?: number; pageToken?: string } = {},
): Promise<PickedMediaPage> {
  const params = new URLSearchParams({ sessionId, pageSize: String(Math.max(1, Math.min(100, options.pageSize ?? 100))) });
  if (options.pageToken) params.set('pageToken', options.pageToken);
  return googleJson<PickedMediaPage>(`https://photospicker.googleapis.com/v1/mediaItems?${params.toString()}`, accessToken);
}

export async function listAllPickedMedia(accessToken: string, sessionId: string): Promise<PickedMediaItem[]> {
  const items: PickedMediaItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listPickedMedia(accessToken, sessionId, { pageSize: 100, pageToken });
    items.push(...(page.mediaItems ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

/** Picker media base URLs are session-bound and must not be persisted as durable media URLs. */
export function pickedMediaDownloadUrl(item: PickedMediaItem): string {
  const baseUrl = item.mediaFile?.baseUrl;
  if (!baseUrl) throw new Error('PICKED_MEDIA_BASE_URL_MISSING');
  const isVideo = item.mediaFile?.mimeType?.startsWith('video/') || item.type === 'VIDEO';
  return `${baseUrl}${isVideo ? '=dv' : '=d'}`;
}

export async function downloadPickedMedia(item: PickedMediaItem): Promise<Response> {
  const response = await fetch(pickedMediaDownloadUrl(item));
  if (!response.ok) throw new Error(`Google Photos download ${response.status}: ${await response.text()}`);
  return response;
}

export async function uploadPhotoBytes(
  accessToken: string,
  bytes: BodyInit,
  mimeType = 'application/octet-stream',
): Promise<string> {
  const response = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mimeType,
      'X-Goog-Upload-Protocol': 'raw',
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Google Photos upload ${response.status}: ${await response.text()}`);
  const token = await response.text();
  if (!token) throw new Error('GOOGLE_PHOTOS_UPLOAD_TOKEN_MISSING');
  return token;
}

export type CreatedMediaItemResult = {
  uploadToken?: string;
  status?: { message?: string; code?: number };
  mediaItem?: { id?: string; productUrl?: string; filename?: string; mimeType?: string };
};

export async function createMediaItems(
  accessToken: string,
  items: Array<{ uploadToken: string; filename?: string; description?: string }>,
): Promise<CreatedMediaItemResult[]> {
  if (!items.length) return [];
  const response = await googleJson<{ newMediaItemResults?: CreatedMediaItemResult[] }>(
    'https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        newMediaItems: items.map(item => ({
          description: item.description,
          simpleMediaItem: { uploadToken: item.uploadToken, fileName: item.filename },
        })),
      }),
    },
  );
  return response.newMediaItemResults ?? [];
}

export type MigrationTarget = 'google_photos' | 'google_drive';
export type MigrationItemResult = {
  sourceId: string;
  filename?: string;
  target: MigrationTarget;
  success: boolean;
  targetId?: string;
  error?: string;
};

export async function transferPickedItems(
  sourceItems: PickedMediaItem[],
  target: MigrationTarget,
  transfer: (input: { item: PickedMediaItem; response: Response; target: MigrationTarget }) => Promise<{ targetId?: string }>,
  onProgress?: (completed: number, total: number, current: PickedMediaItem) => void,
): Promise<MigrationItemResult[]> {
  const results: MigrationItemResult[] = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    onProgress?.(index, sourceItems.length, item);
    try {
      const response = await downloadPickedMedia(item);
      const saved = await transfer({ item, response, target });
      results.push({ sourceId: item.id, filename: item.mediaFile?.filename, target, success: true, targetId: saved.targetId });
    } catch (error) {
      results.push({ sourceId: item.id, filename: item.mediaFile?.filename, target, success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (sourceItems.length) onProgress?.(sourceItems.length, sourceItems.length, sourceItems[sourceItems.length - 1]);
  return results;
}

export * from './migration';
