# PhotoSync Desktop Lib

This folder is the provider-agnostic backend layer for the desktop app. Existing code in `desktop/electron/main.ts` is intentionally kept intact while migration can happen incrementally.

## Goals

- Desktop exposes one stable API to mobile.
- Mobile does not know whether a file lives on Google Drive, OneDrive, Dropbox, S3, NAS, local disk, etc.
- Replication policy is independent from a provider SDK.
- A media item can have replicas across different providers/accounts.
- Adding a provider must not require changing replication or mobile API code.

## Components

- `storage/StorageProvider.ts`: provider contract and shared DTOs.
- `storage/StorageProviderRegistry.ts`: runtime registry / extension point.
- `storage/ReplicationService.ts`: chooses destinations and creates N replicas across registered providers.
- `storage/CallbackStorageProvider.ts`: adapter for legacy functions. Use this first for current Google Drive code so old code does not need to be deleted.
- `api/MobileApiService.ts`: stable `/api/v1/*` interface for mobile.
- `index.ts`: `PhotoSyncDesktopLib` composition facade.

## Storage identity

Never identify a replica only by `accountId`. Always persist both:

```ts
{
  providerId: 'google-drive',
  accountId: 'drive-abc123',
  remoteFileId: '...'
}
```

That prevents collisions when multiple storage systems use similar account identifiers.

## Add a new provider

Create one class implementing `StorageProvider`:

```ts
import { StorageProvider } from './StorageProvider.js';

export class OneDriveProvider extends StorageProvider {
  readonly id = 'onedrive';
  readonly displayName = 'Microsoft OneDrive';

  async listAccounts() { /* provider SDK/API only */ }
  async upload(input) { /* provider SDK/API only */ }
  async download(input) { /* provider SDK/API only */ }
}
```

Then register it once during desktop startup:

```ts
desktopLib.registerStorageProvider(new OneDriveProvider(...));
```

`ReplicationService` and `MobileApiService` require no changes.

## Migration path for current Google Drive code

Do not delete the old Drive functions yet. Wrap them with `CallbackStorageProvider`:

```ts
const googleDrive = new CallbackStorageProvider('google-drive', 'Google Drive', {
  listAccounts: async () => /* map runtimeDriveAccounts() to StorageAccount[] */,
  upload: async input => /* call existing resumable upload logic */,
  download: async input => /* call existing Drive download logic */,
  connectAccount: connectGoogle,
  removeAccount: removeDriveAccount,
});

desktopLib.registerStorageProvider(googleDrive);
```

After the bridge is stable, provider-specific functions can be moved out of `main.ts` one by one without changing the API seen by mobile.

## Recommended persistent media schema

The existing `cloudReplicas` should evolve additively to include `providerId`:

```ts
type Replica = {
  providerId: string;
  accountId: string;
  state: 'QUEUED' | 'UPLOADING' | 'VERIFIED' | 'ERROR';
  remoteFileId?: string;
  remotePath?: string;
  webViewLink?: string;
};
```

For backward compatibility, old replicas without `providerId` can be interpreted as `google-drive` during migration.
