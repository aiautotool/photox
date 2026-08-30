import type { StorageDownloadResult, StorageObject, StorageUploadInput } from '@photox/contracts';
import type { TelegramBotApiAdapter, TelegramBotIdentity, TelegramResolvedAccount, TelegramUploadResult } from './types';

export interface TelegramHttpAdapterOptions {
  fetcher?: typeof fetch;
  loadFile?: (uri: string) => Promise<Uint8Array>;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessageResult {
  message_id: number;
  document?: {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
}

interface TelegramFileResult {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export class TelegramHttpBotApiAdapter implements TelegramBotApiAdapter {
  private readonly fetcher: typeof fetch;
  private readonly loadFile?: (uri: string) => Promise<Uint8Array>;

  constructor(options: TelegramHttpAdapterOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.loadFile = options.loadFile;
  }

  async verifyBot(account: TelegramResolvedAccount): Promise<TelegramBotIdentity> {
    const result = await this.call<{ id: number; username?: string; first_name?: string }>(account, 'getMe');
    return { id: result.id, username: result.username, firstName: result.first_name };
  }

  async healthCheck(account: TelegramResolvedAccount): Promise<boolean> {
    try {
      await this.verifyBot(account);
      return true;
    } catch {
      return false;
    }
  }

  async sendDocument(account: TelegramResolvedAccount, input: StorageUploadInput): Promise<TelegramUploadResult> {
    const bytes = input.data ?? (input.localUri && this.loadFile ? await this.loadFile(input.localUri) : undefined);
    if (!bytes) throw new Error('TelegramHttpBotApiAdapter requires input.data or a loadFile adapter for localUri');

    const body = new FormData();
    body.set('chat_id', account.chatId);
    body.set('caption', `PhotoX:${input.key}`);
    body.set('document', new Blob([bytes], { type: input.mimeType }), input.filename);

    const message = await this.call<TelegramMessageResult>(account, 'sendDocument', { method: 'POST', body });
    const document = message.document;
    if (!document?.file_id) throw new Error('Telegram sendDocument response did not contain document.file_id');

    const object: StorageObject = {
      providerId: 'telegram-bot',
      accountId: input.accountId,
      remoteFileId: document.file_id,
      sizeBytes: document.file_size ?? input.sizeBytes,
      checksum: input.sha256,
      metadata: {
        telegramMessageId: message.message_id,
        telegramFileUniqueId: document.file_unique_id,
      },
    };

    return {
      object,
      messageId: message.message_id,
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
    };
  }

  async download(account: TelegramResolvedAccount, fileId: string): Promise<StorageDownloadResult> {
    const file = await this.call<TelegramFileResult>(account, 'getFile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!file.file_path) throw new Error('Telegram getFile response did not contain file_path');
    if (account.downloadLimitBytes !== undefined && file.file_size !== undefined && file.file_size > account.downloadLimitBytes) {
      throw new Error(`Telegram download exceeds configured limit: ${file.file_size} > ${account.downloadLimitBytes}`);
    }

    const base = account.apiBaseUrl ?? 'https://api.telegram.org';
    const response = await this.fetcher(`${base}/file/bot${account.botToken}/${file.file_path}`);
    if (!response.ok) throw new Error(`Telegram file download failed: HTTP ${response.status}`);
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: response.body,
    };
  }

  private async call<T>(account: TelegramResolvedAccount, method: string, init?: RequestInit): Promise<T> {
    const base = account.apiBaseUrl ?? 'https://api.telegram.org';
    const response = await this.fetcher(`${base}/bot${account.botToken}/${method}`, init);
    const payload = await response.json() as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description ?? `Telegram Bot API ${method} failed: HTTP ${response.status}`);
    }
    return payload.result;
  }
}
