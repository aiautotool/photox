import { StorageProvider, type DownloadInput, type DownloadResult, type StorageAccount, type StorageObject, type UploadInput } from './StorageProvider.js';

export type StorageProviderCallbacks = {
  listAccounts: () => Promise<StorageAccount[]>;
  upload: (input: UploadInput) => Promise<StorageObject>;
  download: (input: DownloadInput) => Promise<DownloadResult>;
  connectAccount?: () => Promise<unknown>;
  removeAccount?: (accountId: string) => Promise<void>;
  healthCheck?: () => Promise<boolean>;
};

/**
 * Bridge for existing storage code. It lets the current Google Drive logic be
 * registered as a provider without deleting or rewriting the legacy functions.
 */
export class CallbackStorageProvider extends StorageProvider {
  constructor(
    readonly id: string,
    readonly displayName: string,
    private readonly callbacks: StorageProviderCallbacks,
  ) {
    super();
  }

  listAccounts(): Promise<StorageAccount[]> {
    return this.callbacks.listAccounts();
  }

  upload(input: UploadInput): Promise<StorageObject> {
    return this.callbacks.upload(input);
  }

  download(input: DownloadInput): Promise<DownloadResult> {
    return this.callbacks.download(input);
  }

  connectAccount(): Promise<unknown> {
    if (!this.callbacks.connectAccount) throw new Error(`${this.displayName} does not support account connection`);
    return this.callbacks.connectAccount();
  }

  removeAccount(accountId: string): Promise<void> {
    if (!this.callbacks.removeAccount) throw new Error(`${this.displayName} does not support account removal`);
    return this.callbacks.removeAccount(accountId);
  }

  healthCheck(): Promise<boolean> {
    return this.callbacks.healthCheck ? this.callbacks.healthCheck() : Promise.resolve(true);
  }
}
