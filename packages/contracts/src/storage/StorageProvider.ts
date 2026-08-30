export type StorageProviderId = string;
export type StorageAccountId = string;

export type StorageCapability =
  | 'UPLOAD' | 'DOWNLOAD' | 'DELETE' | 'QUOTA' | 'WEB_LINK'
  | 'RESUMABLE_UPLOAD' | 'RANGE_READ' | 'LOCAL_NETWORK' | 'VIDEO_ARCHIVE';

export type StorageAccountStatus = 'ready' | 'unavailable' | 'full' | 'auth_required';

export interface StorageQuota {
  usedBytes?: number;
  freeBytes?: number;
  totalBytes?: number;
}

export interface StorageAccount extends StorageQuota {
  providerId: StorageProviderId;
  accountId: StorageAccountId;
  displayName: string;
  email?: string;
  status: StorageAccountStatus;
  metadata?: Record<string, unknown>;
}

export interface StorageProviderDescriptor {
  id: StorageProviderId;
  name: string;
  capabilities: StorageCapability[];
  version?: string;
}

export interface StorageObject {
  providerId: StorageProviderId;
  accountId: StorageAccountId;
  remoteFileId: string;
  remotePath?: string;
  webViewLink?: string;
  sizeBytes?: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

export type ReplicaState = 'QUEUED' | 'UPLOADING' | 'UPLOADED' | 'VERIFYING' | 'VERIFIED' | 'BLOCKED' | 'ERROR';

export interface StorageReplica extends Partial<StorageObject> {
  providerId: StorageProviderId;
  state: ReplicaState;
  uploadedAt?: string;
  verifiedAt?: string;
  message?: string;
}

export interface StorageUploadInput {
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  accountId: StorageAccountId;
  localUri?: string;
  data?: Uint8Array;
}

export interface StorageDownloadInput {
  accountId: StorageAccountId;
  remoteFileId: string;
  range?: string;
}

export interface StorageDownloadResult {
  status: number;
  headers?: Record<string,string>;
  body: unknown;
}

export interface StorageProvider {
  readonly id: StorageProviderId;
  readonly name: string;
  descriptor(): StorageProviderDescriptor;
  listAccounts(): Promise<StorageAccount[]>;
  upload(input: StorageUploadInput): Promise<StorageObject>;
  download(input: StorageDownloadInput): Promise<StorageDownloadResult>;
  connectAccount?(): Promise<StorageAccount>;
  removeAccount?(accountId: StorageAccountId): Promise<void>;
  delete?(accountId: StorageAccountId, remoteFileId: string): Promise<void>;
  getQuota?(accountId: StorageAccountId): Promise<StorageQuota>;
  healthCheck?(accountId: StorageAccountId): Promise<boolean>;
}
