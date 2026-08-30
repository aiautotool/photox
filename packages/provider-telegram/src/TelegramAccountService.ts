import type { TelegramAccountConfig, TelegramConfigStore, TelegramResolvedAccount, SecretStore } from './types';

export const TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const TELEGRAM_CLOUD_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
export const TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES = 2000 * 1024 * 1024;

export class MemoryTelegramConfigStore implements TelegramConfigStore {
  private readonly configs = new Map<string, TelegramAccountConfig>();
  async list(): Promise<TelegramAccountConfig[]> { return [...this.configs.values()]; }
  async get(accountId: string): Promise<TelegramAccountConfig | undefined> { return this.configs.get(accountId); }
  async save(config: TelegramAccountConfig): Promise<void> { this.configs.set(config.accountId, { ...config }); }
  async remove(accountId: string): Promise<void> { this.configs.delete(accountId); }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(secretKey: string): Promise<string | null> { return this.values.get(secretKey) ?? null; }
  async set(secretKey: string, value: string): Promise<void> { this.values.set(secretKey, value); }
  async remove(secretKey: string): Promise<void> { this.values.delete(secretKey); }
}

export class TelegramAccountService {
  constructor(private readonly configs: TelegramConfigStore, private readonly secrets: SecretStore) {}

  async save(config: TelegramAccountConfig, botToken?: string): Promise<void> {
    if (!config.accountId.trim()) throw new Error('Telegram accountId is required');
    if (!config.chatId.trim()) throw new Error('Telegram chatId is required');
    if (!config.botTokenSecretKey.trim()) throw new Error('Telegram botTokenSecretKey is required');
    await this.configs.save(this.withDefaults(config));
    if (botToken !== undefined) await this.secrets.set(config.botTokenSecretKey, botToken);
  }

  async remove(accountId: string): Promise<void> {
    const config = await this.configs.get(accountId);
    if (config) await this.secrets.remove(config.botTokenSecretKey);
    await this.configs.remove(accountId);
  }

  async list(): Promise<TelegramAccountConfig[]> {
    const configs = await this.configs.list();
    return configs.map((config) => this.withDefaults(config));
  }

  async resolve(accountId: string): Promise<TelegramResolvedAccount> {
    const config = await this.configs.get(accountId);
    if (!config) throw new Error(`Unknown Telegram account: ${accountId}`);
    const botToken = await this.secrets.get(config.botTokenSecretKey);
    if (!botToken) throw new Error(`Telegram bot token is missing for account: ${accountId}`);
    return { ...this.withDefaults(config), botToken };
  }

  private withDefaults(config: TelegramAccountConfig): TelegramAccountConfig {
    if (config.apiMode === 'local-bot-api') {
      return {
        ...config,
        apiBaseUrl: config.apiBaseUrl ?? 'http://127.0.0.1:8081',
        uploadLimitBytes: config.uploadLimitBytes ?? TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES,
      };
    }
    return {
      ...config,
      apiBaseUrl: config.apiBaseUrl ?? 'https://api.telegram.org',
      uploadLimitBytes: config.uploadLimitBytes ?? TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES,
      downloadLimitBytes: config.downloadLimitBytes ?? TELEGRAM_CLOUD_DOWNLOAD_LIMIT_BYTES,
    };
  }
}
