import type { Readable } from 'node:stream';

export type StorageProviderId = string;
export type StorageAccountId = string;

export type StorageAccountStatus = 'ready' | 'unavailable' | 'full' | 'auth_required';

export type StorageAccount = {
  providerId: StorageProviderId;
  accountId: StorageAccountId;
  displayName: string;
  email?: string;
  usedBytes: number;
  freeBytes: number;
  totalBytes: number;
  status: StorageAccountStatus;
  metadata?: Record<string, unknown>;
};

export type StorageObject = {
  providerId: StorageProviderId;
  accountId: StorageAccountId;
  remoteFileId: string;
  remotePath?: string;
  webViewLink?: string;
  sizeBytes?: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
};

export type UploadInput = {
  key: string;
  filename: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  accountId: StorageAccountId;
};

export type DownloadInput = {
  accountId: StorageAccountId;
  remoteFileId: string;
  range?: string;
};

export type DownloadResult = {
  status: number;
  headers: Record<string, string>;
  body: Readable;
};

/**
 * Contract implemented by every remote storage backend.
 * Business logic must depend on this abstraction, never on Google Drive,
 * Dropbox, OneDrive, S3, NAS, etc. directly.
 */
export abstract class StorageProvider {
  abstract readonly id: StorageProviderId;
  abstract readonly displayName: string;

  abstract listAccounts(): Promise<StorageAccount[]>;
  abstract upload(input: UploadInput): Promise<StorageObject>;
  abstract download(input: DownloadInput): Promise<DownloadResult>;

  /** Optional provider-specific account connection flow. */
  connectAccount?(): Promise<unknown>;

  /** Optional provider-specific account removal flow. */
  removeAccount?(accountId: StorageAccountId): Promise<void>;

  /** Optional lightweight health check. */
  healthCheck?(): Promise<boolean>;
}
