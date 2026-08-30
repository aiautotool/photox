import type { StorageDownloadResult, StorageObject, StorageUploadInput } from '@photox/contracts';

export type TelegramApiMode = 'cloud' | 'local-bot-api';

export interface TelegramAccountConfig {
  accountId: string;
  displayName: string;
  chatId: string;
  botTokenSecretKey: string;
  enabled: boolean;
  apiMode: TelegramApiMode;
  apiBaseUrl?: string;
  uploadLimitBytes?: number;
  downloadLimitBytes?: number;
  channelUsername?: string;
  metadata?: Record<string, unknown>;
}

export interface TelegramResolvedAccount extends TelegramAccountConfig {
  botToken: string;
}

export interface TelegramBotIdentity {
  id: number;
  username?: string;
  firstName?: string;
}

export interface TelegramStoredMedia {
  id: string;
  accountId: string;
  chatId: string;
  messageId: number;
  fileId: string;
  fileUniqueId?: string;
  filename: string;
  mimeType: string;
  mediaType: 'image' | 'video' | 'other';
  sizeBytes: number;
  sha256: string;
  storedAt: string;
  sourceKey: string;
}

export interface TelegramAccountStats {
  accountId: string;
  displayName?: string;
  mediaCount: number;
  imageCount: number;
  videoCount: number;
  otherCount: number;
  totalBytes: number;
  lastStoredAt?: string;
}

export interface TelegramProviderStats {
  providerId: 'telegram-bot';
  accounts: TelegramAccountStats[];
  totalMedia: number;
  totalBytes: number;
}

export interface TelegramUploadResult {
  object: StorageObject;
  messageId: number;
  fileId: string;
  fileUniqueId?: string;
}

export interface TelegramBotApiAdapter {
  verifyBot(account: TelegramResolvedAccount): Promise<TelegramBotIdentity>;
  sendDocument(account: TelegramResolvedAccount, input: StorageUploadInput): Promise<TelegramUploadResult>;
  download(account: TelegramResolvedAccount, fileId: string): Promise<StorageDownloadResult>;
  healthCheck(account: TelegramResolvedAccount): Promise<boolean>;
}

export interface SecretStore {
  get(secretKey: string): Promise<string | null>;
  set(secretKey: string, value: string): Promise<void>;
  remove(secretKey: string): Promise<void>;
}

export interface TelegramConfigStore {
  list(): Promise<TelegramAccountConfig[]>;
  get(accountId: string): Promise<TelegramAccountConfig | undefined>;
  save(config: TelegramAccountConfig): Promise<void>;
  remove(accountId: string): Promise<void>;
}

export interface TelegramMediaRepository {
  add(record: TelegramStoredMedia): Promise<void>;
  list(accountId?: string): Promise<TelegramStoredMedia[]>;
  removeByFileId(accountId: string, fileId: string): Promise<void>;
}
