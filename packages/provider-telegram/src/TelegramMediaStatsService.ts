import type { TelegramAccountStats, TelegramMediaRepository, TelegramProviderStats, TelegramStoredMedia } from './types';

export class MemoryTelegramMediaRepository implements TelegramMediaRepository {
  private readonly records: TelegramStoredMedia[] = [];

  async add(record: TelegramStoredMedia): Promise<void> {
    const index = this.records.findIndex((item) => item.workspaceId === record.workspaceId && item.accountId === record.accountId && item.fileId === record.fileId);
    if (index >= 0) this.records[index] = { ...record };
    else this.records.push({ ...record });
  }

  async list(workspaceId: string, accountId?: string): Promise<TelegramStoredMedia[]> {
    return this.records
      .filter((record) => record.workspaceId === workspaceId && (!accountId || record.accountId === accountId))
      .map((record) => ({ ...record }));
  }

  async removeByFileId(workspaceId: string, accountId: string, fileId: string): Promise<void> {
    const index = this.records.findIndex((record) => record.workspaceId === workspaceId && record.accountId === accountId && record.fileId === fileId);
    if (index >= 0) this.records.splice(index, 1);
  }
}

export class TelegramMediaStatsService {
  constructor(private readonly media: TelegramMediaRepository, private readonly workspaceId: string) {
    if (!workspaceId.trim()) throw new Error('Telegram workspaceId is required');
  }

  async getStats(displayNames: Record<string, string> = {}): Promise<TelegramProviderStats> {
    const records = await this.media.list(this.workspaceId);
    const byAccount = new Map<string, TelegramAccountStats>();

    for (const record of records) {
      if (record.workspaceId !== this.workspaceId) throw new Error('TELEGRAM_WORKSPACE_MISMATCH');
      const current = byAccount.get(record.accountId) ?? {
        workspaceId: this.workspaceId,
        accountId: record.accountId,
        displayName: displayNames[record.accountId],
        mediaCount: 0,
        imageCount: 0,
        videoCount: 0,
        otherCount: 0,
        totalBytes: 0,
      };
      current.mediaCount += 1;
      current.totalBytes += record.sizeBytes;
      if (record.mediaType === 'image') current.imageCount += 1;
      else if (record.mediaType === 'video') current.videoCount += 1;
      else current.otherCount += 1;
      if (!current.lastStoredAt || record.storedAt > current.lastStoredAt) current.lastStoredAt = record.storedAt;
      byAccount.set(record.accountId, current);
    }

    const accounts = [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId));
    return {
      providerId: 'telegram-bot',
      workspaceId: this.workspaceId,
      accounts,
      totalMedia: accounts.reduce((sum, account) => sum + account.mediaCount, 0),
      totalBytes: accounts.reduce((sum, account) => sum + account.totalBytes, 0),
    };
  }
}
