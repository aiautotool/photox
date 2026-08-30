# PhotoX SDK Architecture

This branch builds reusable libraries beside the existing application. It does not replace or import them into the current desktop/mobile apps yet.

## Packages

- `@photox/contracts`: platform-neutral contracts for media, storage providers, replicas, sync, devices, pairing, events and updates.
- `@photox/storage`: provider registry, policy engine and replication service.
- `@photox/sync`: event bus, queue and sync engine.
- `@photox/media`: media index plus interfaces for hash/metadata/thumbnail platform adapters.
- `@photox/transport`: transport contract and HTTP implementation.
- `@photox/update-core`: version and update-manifest checking.
- `@photox/provider-local`: Node/Electron local disk provider.
- `@photox/provider-google-drive`: Google Drive provider wrapper around an injected adapter.
- `@photox/desktop-sdk`: desktop facade composing storage, media, sync and update services.
- `@photox/mobile-sdk`: mobile facade, desktop API client and pairing persistence abstraction.

## Provider rule

Every backend implements `StorageProvider` from `@photox/contracts` and registers once:

```ts
sdk.registerStorageProvider(new GoogleDriveProvider(adapter));
sdk.registerStorageProvider(new LocalStorageProvider('/data/photox'));
```

Adding OneDrive, Dropbox, S3, WebDAV or NAS must not require changing `ReplicationService`, `StoragePolicyEngine`, mobile API contracts or app UI.

## Replica identity

Always persist both `providerId` and `accountId`. Legacy replicas without `providerId` should be interpreted as `google-drive` only during migration.

## Update design

`@photox/update-core` understands a provider-neutral `UpdateManifest`. CI/CD can host manifests and artifacts on GitHub Releases, Cloudflare R2, S3 or another CDN. Platform SDKs decide how to install an artifact; core only selects compatible versions and validates manifest compatibility.

## Migration rule

Do not delete current application code. Migrate incrementally by wrapping old implementations as adapters, then switch one subsystem at a time after tests pass.
