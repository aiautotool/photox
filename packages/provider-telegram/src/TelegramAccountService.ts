import type { TelegramAccountConfig, TelegramConfigStore, TelegramResolvedAccount, SecretStore } from './types';

export const TELEGRAM_CLOUD_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
export const TELEGRAM_CLOUD_DOWNLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
export const TELEGRAM_LOCAL_UPLOAD_LIMIT_BYTES = 2000 * 1024 * 1024;

function configKey(workspaceId: string, accountId: string) {
  return `${workspaceId}\u0000${accountId}`;
}

export class MemoryTelegramConfigStore implements TelegramConfigStore {
  private readonly configs = new Map<string, TelegramAccountConfig>();
  async list(workspaceId: string): Promise<TelegramAccountConfig[]> {
    return [...this.configs.values()].filter((config) => config.workspaceId === workspaceId).map((config) => ({ ...config }));
  }
  async get(workspaceId: string, accountId: string): Promise<TelegramAccountConfig | undefined> {
    const config = this.configs.get(configKey(workspaceId, accountId));
    return config ? { ...config } : undefined;
  }
  async save(config: TelegramAccountConfig): Promise<void> {
    this.configs.set(configKey(config.workspaceId, config.accountId), { ...config });
  }
  async remove(workspaceId: string, accountId: string): Promise<void> {
    this.configs.delete(configKey(workspaceId, accountId));
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  async get(secretKey: string): Promise<string | null> { return this.values.get(secretKey) ?? null; }
  async set(secretKey: string, value: string): Promise<void> { this.values.set(secretKey, value); }
  async remove(secretKey: string): Promise<void> { this.values.delete(secretKey); }
}

export class TelegramAccountService {
  constructor(
    private readonly configs: TelegramConfigStore,
    private readonly secrets: SecretStore,
    private readonly workspaceId: string,
  ) {
    if (!workspaceId.trim()) throw new Error('Telegram workspaceId is required');
  }

  async save(config: TelegramAccountConfig, botToken?: string): Promise<void> {
    this.assertWorkspace(config.workspaceId);
    if (!config.accountId.trim()) throw new Error('Telegram accountId is required');
    if (!config.chatId.trim()) throw new Error('Telegram chatId is required');
    if (!config.botTokenSecretKey.trim()) throw new Error('Telegram botTokenSecretKey is required');
    await this.configs.save(this.withDefaults(config));
    if (botToken !== undefined) await this.secrets.set(this.scopedSecretKey(config.botTokenSecretKey), botToken);
  }

  async remove(accountId: string): Promise<void> {
    const config = await this.configs.get(this.workspaceId, accountId);
    if (config) await this.secrets.remove(this.scopedSecretKey(config.botTokenSecretKey));
    await this.configs.remove(this.workspaceId, accountId);
  }

  async list(): Promise<TelegramAccountConfig[]> {
    const configs = await this.configs.list(this.workspaceId);
    return configs.map((config) => this.withDefaults(config));
  }

  async resolve(accountId: string): Promise<TelegramResolvedAccount> {
    const config = await this.configs.get(this.workspaceId, accountId);
    if (!config) throw new Error(`Unknown Telegram account in workspace ${this.workspaceId}: ${accountId}`);
    this.assertWorkspace(config.workspaceId);
    const botToken = await this.secrets.get(this.scopedSecretKey(config.botTokenSecretKey));
    if (!botToken) throw new Error(`Telegram bot token is missing for account: ${accountId}`);
    return { ...this.withDefaults(config), botToken };
  }

  private scopedSecretKey(secretKey: string): string {
    return `photox.workspace.${encodeURIComponent(this.workspaceId)}.${secretKey}`;
  }

  private assertWorkspace(workspaceId: string) {
    if (workspaceId !== this.workspaceId) throw new Error('TELEGRAM_WORKSPACE_MISMATCH');
  }

  private withDefaults(config: TelegramAccountConfig): TelegramAccountConfig {
    this.assertWorkspace(config.workspaceId);
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
