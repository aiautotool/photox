import type { StorageAccount, StorageDownloadInput, StorageObject, StorageProvider, StorageProviderDescriptor, StorageUploadInput } from '@photox/contracts';
import { TelegramAccountService } from './TelegramAccountService';
import type { TelegramBotApiAdapter, TelegramMediaRepository, TelegramStoredMedia } from './types';

function mediaType(mimeType: string): TelegramStoredMedia['mediaType'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'other';
}

export class TelegramStorageProvider implements StorageProvider {
  readonly id = 'telegram-bot';
  readonly name = 'Telegram Bot Storage';

  constructor(
    private readonly accounts: TelegramAccountService,
    private readonly api: TelegramBotApiAdapter,
    private readonly media: TelegramMediaRepository,
  ) {}

  descriptor(): StorageProviderDescriptor {
    return {
      id: this.id,
      name: this.name,
      version: '0.1.0',
      capabilities: ['UPLOAD', 'DOWNLOAD', 'VIDEO_ARCHIVE'],
    };
  }

  async listAccounts(): Promise<StorageAccount[]> {
    const configs = await this.accounts.list();
    return Promise.all(configs.map(async (config) => {
      if (!config.enabled) {
        return {
          providerId: this.id,
          accountId: config.accountId,
          displayName: config.displayName,
          usedBytes: 0,
          status: 'unavailable' as const,
          metadata: this.metadata(config),
        };
      }
      try {
        const resolved = await this.accounts.resolve(config.accountId);
        const healthy = await this.api.healthCheck(resolved);
        return {
          providerId: this.id,
          accountId: config.accountId,
          displayName: config.displayName,
          usedBytes: 0,
          status: healthy ? 'ready' as const : 'unavailable' as const,
          metadata: this.metadata(config),
        };
      } catch {
        return {
          providerId: this.id,
          accountId: config.accountId,
          displayName: config.displayName,
          usedBytes: 0,
          status: 'auth_required' as const,
          metadata: this.metadata(config),
        };
      }
    }));
  }

  async upload(input: StorageUploadInput): Promise<StorageObject> {
    const account = await this.accounts.resolve(input.accountId);
    if (!account.enabled) throw new Error(`Telegram account is disabled: ${input.accountId}`);
    if (account.uploadLimitBytes !== undefined && input.sizeBytes > account.uploadLimitBytes) {
      throw new Error(`Telegram upload exceeds configured limit for ${input.accountId}: ${input.sizeBytes} > ${account.uploadLimitBytes}`);
    }

    const result = await this.api.sendDocument(account, input);
    await this.media.add({
      id: `${this.accounts.workspaceId}:${input.accountId}:${result.fileId}`,
      workspaceId: this.accounts.workspaceId,
      accountId: input.accountId,
      chatId: account.chatId,
      messageId: result.messageId,
      fileId: result.fileId,
      fileUniqueId: result.fileUniqueId,
      filename: input.filename,
      mimeType: input.mimeType,
      mediaType: mediaType(input.mimeType),
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      storedAt: new Date().toISOString(),
      sourceKey: input.key,
    });

    return {
      ...result.object,
      providerId: this.id,
      accountId: input.accountId,
      remoteFileId: result.fileId,
      sizeBytes: input.sizeBytes,
      checksum: input.sha256,
      metadata: {
        ...(result.object.metadata ?? {}),
        telegramMessageId: result.messageId,
        telegramFileUniqueId: result.fileUniqueId,
        telegramChatId: account.chatId,
      },
    };
  }

  async download(input: StorageDownloadInput) {
    const account = await this.accounts.resolve(input.accountId);
    return this.api.download(account, input.remoteFileId);
  }

  async healthCheck(accountId: string): Promise<boolean> {
    const account = await this.accounts.resolve(accountId);
    return this.api.healthCheck(account);
  }

  private metadata(config: Awaited<ReturnType<TelegramAccountService['list']>>[number]): Record<string, unknown> {
    return {
      apiMode: config.apiMode,
      apiBaseUrl: config.apiBaseUrl,
      uploadLimitBytes: config.uploadLimitBytes,
      downloadLimitBytes: config.downloadLimitBytes,
      chatId: config.chatId,
      channelUsername: config.channelUsername,
      enabled: config.enabled,
    };
  }
}
