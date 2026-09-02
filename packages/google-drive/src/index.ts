export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const PHOTOSYNC_FOLDER = 'PhotoSync';

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; createdTime?: string; modifiedTime?: string; md5Checksum?: string; parents?: string[]; webViewLink?: string };
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
  const data = await googleFetch<{files: DriveFile[]}>(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=1000&fields=files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,parents,webViewLink)`, accessToken);
  return data.files;
}

export function getDriveFile(accessToken: string, fileId: string): Promise<DriveFile> {
  return googleFetch<DriveFile>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,parents,webViewLink`, accessToken);
}

export async function createResumableUploadSession(
  accessToken: string,
  input: { name: string; mimeType: string; sizeBytes: number; folderId: string; appProperties?: Record<string,string> },
): Promise<string> {
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime', {
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

export function driveDownloadUrl(fileId: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
}
