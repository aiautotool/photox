export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const PHOTOSYNC_FOLDER = 'PhotoSync';

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string; md5Checksum?: string; parents?: string[]; webViewLink?: string; appProperties?: Record<string,string> };
export type DriveQuota = { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string };

async function googleFetch<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`Google Drive ${response.status}: ${await response.text()}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getStorageQuota(accessToken: string): Promise<DriveQuota> {
  const data = await googleFetch<{storageQuota: DriveQuota}>('https://www.googleapis.com/drive/v3/about?fields=storageQuota', accessToken);
  return data.storageQuota;
}

export async function findPhotoSyncFolder(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${PHOTOSYNC_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const data = await googleFetch<{files: DriveFile[]}>(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)&pageSize=10`, accessToken);
  return data.files[0]?.id ?? null;
}

export async function ensurePhotoSyncFolder(accessToken: string): Promise<string> {
  const existing = await findPhotoSyncFolder(accessToken);
  if (existing) return existing;
  const folder = await googleFetch<DriveFile>('https://www.googleapis.com/drive/v3/files?fields=id,name', accessToken, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: PHOTOSYNC_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return folder.id;
}

export async function listPhotoSyncFiles(accessToken: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await googleFetch<{files: DriveFile[]}>(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,parents,webViewLink,appProperties)`, accessToken);
  return data.files;
}

export function getDriveFile(accessToken: string, fileId: string): Promise<DriveFile> {
  return googleFetch<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,parents,webViewLink,appProperties`, accessToken);
}

export async function createResumableUploadSession(
  accessToken: string,
  input: { name: string; mimeType: string; sizeBytes: number; folderId: string; appProperties?: Record<string,string> },
): Promise<string> {
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,createdTime,webViewLink,md5Checksum,appProperties', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': input.mimeType,
      'X-Upload-Content-Length': String(input.sizeBytes),
    },
    body: JSON.stringify({ name: input.name, mimeType: input.mimeType, parents: [input.folderId], appProperties: input.appProperties }),
  });
  if (!response.ok) throw new Error(`Drive session ${response.status}: ${await response.text()}`);
  const location = response.headers.get('location');
  if (!location) throw new Error('Drive did not return a resumable upload session URI');
  return location;
}

export type DriveResumableUploadStatus =
  | { state: 'active'; committedBytes: number }
  | { state: 'completed'; file: DriveFile }
  | { state: 'expired' };

function committedBytesFromRange(value: string | null): number {
  if (!value) return 0;
  const match = /^bytes=0-(\d+)$/.exec(value.trim());
  return match ? Number(match[1]) + 1 : 0;
}

async function completedDriveFile(response: Response): Promise<DriveFile> {
  const file = await response.json() as DriveFile;
  if (!file?.id) throw new Error('GOOGLE_DRIVE_DESTINATION_ID_MISSING');
  return file;
}

/** Query a Google Drive resumable session without re-uploading bytes. */
export async function queryResumableUploadSession(
  sessionUri: string,
  totalBytes: number,
  request: typeof fetch = fetch,
): Promise<DriveResumableUploadStatus> {
  const response = await request(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Length': '0', 'Content-Range': `bytes */${Math.max(0, Math.floor(totalBytes))}` },
  });
  if (response.status === 308) return { state: 'active', committedBytes: committedBytesFromRange(response.headers.get('range')) };
  if (response.status === 404 || response.status === 410) return { state: 'expired' };
  if (response.status === 200 || response.status === 201) return { state: 'completed', file: await completedDriveFile(response) };
  throw new Error(`Drive resumable status ${response.status}: ${await response.text()}`);
}

/** Upload one aligned chunk to an existing resumable session. */
export async function uploadResumableChunk(
  sessionUri: string,
  input: { bytes: Uint8Array; startByte: number; totalBytes: number; mimeType?: string; signal?: AbortSignal },
  request: typeof fetch = fetch,
): Promise<DriveResumableUploadStatus> {
  const startByte = Math.max(0, Math.floor(input.startByte));
  const totalBytes = Math.max(0, Math.floor(input.totalBytes));
  if (!input.bytes.byteLength) throw new Error('GOOGLE_DRIVE_RESUMABLE_EMPTY_CHUNK');
  const endByte = startByte + input.bytes.byteLength - 1;
  if (endByte >= totalBytes) {
    if (endByte !== totalBytes - 1) throw new Error(`GOOGLE_DRIVE_RESUMABLE_RANGE_INVALID:${startByte}:${endByte}:${totalBytes}`);
  }
  const response = await request(sessionUri, {
    method: 'PUT',
    headers: {
      'Content-Type': input.mimeType || 'application/octet-stream',
      'Content-Length': String(input.bytes.byteLength),
      'Content-Range': `bytes ${startByte}-${endByte}/${totalBytes}`,
    },
    body: input.bytes as unknown as BodyInit,
    signal: input.signal,
  });
  if (response.status === 308) return { state: 'active', committedBytes: committedBytesFromRange(response.headers.get('range')) };
  if (response.status === 404 || response.status === 410) return { state: 'expired' };
  if (response.status === 200 || response.status === 201) return { state: 'completed', file: await completedDriveFile(response) };
  throw new Error(`Drive resumable chunk ${response.status}: ${await response.text()}`);
}

export function driveDownloadUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
}
