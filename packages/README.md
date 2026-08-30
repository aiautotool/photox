# PhotoX reusable SDK layer

The SDK layer is intentionally independent from the current desktop and mobile applications. Existing app code does not need to import these packages until migration is desired.

## Packages

- `@photosync/sdk-contracts` — platform-neutral TypeScript contracts shared by desktop, mobile, relay services and future tools.
- `@photosync/desktop-sdk` — desktop-side storage provider registry, replica planning and update manifest client.
- `@photosync/mobile-sdk` — mobile-side client for PhotoX Desktop API, pairing persistence abstraction, retry policy and update manifest client.
- `@photosync/core` — existing core package, unchanged.
- `@photosync/google-drive` — existing Google Drive implementation, unchanged.

## Design goals

1. Existing apps remain untouched until explicitly migrated.
2. Storage backends are plugins. Google Drive, OneDrive, Dropbox, S3, WebDAV, NAS and future providers implement one `StorageProvider` interface.
3. Mobile talks to a stable desktop API contract instead of cloud-provider-specific APIs.
4. Pairing persistence is abstracted behind `KeyValueStore`; Expo SecureStore, AsyncStorage, native keychain, tests or another implementation can be injected later.
5. Release/update logic consumes a provider-neutral `UpdateManifest`; CI can publish the manifest to GitHub Releases, R2, S3, a CDN or the PhotoX relay without changing app logic.
6. Artifacts are SHA-256 verified before desktop installation logic is allowed to consume them.

## Adding a storage provider

Implement `StorageProvider` from `@photosync/desktop-sdk` and register it:

```ts
const registry = new StorageProviderRegistry();
registry.register(new GoogleDriveProvider());
registry.register(new OneDriveProvider());
registry.register(new NasProvider());
```

Replication policy is provider-neutral:

```ts
const planner = new ReplicaPlanner(registry, {
  targetReplicas: 2,
  distinctProviders: false,
  minimumFreeBytes: 100 * 1024 * 1024,
});
```

`distinctProviders: true` can later enforce copies across different cloud vendors instead of merely different accounts.

## Update manifest

A release service publishes JSON matching `UpdateManifest`:

```json
{
  "schemaVersion": 1,
  "appId": "com.aiautotool.photox",
  "channel": "stable",
  "version": "0.7.0",
  "buildId": "github-run-1234",
  "publishedAt": "2026-08-31T00:00:00Z",
  "minimumSupportedVersion": "0.6.0",
  "artifacts": [
    {
      "platform": "desktop",
      "arch": "arm64",
      "url": "https://example.invalid/PhotoX.dmg",
      "sha256": "..."
    },
    {
      "platform": "android",
      "url": "https://example.invalid/PhotoX.apk",
      "sha256": "..."
    }
  ]
}
```

The SDK only checks availability and validates artifacts. Installing/restarting the live app remains a separate platform adapter so the current app is not changed yet.

## CI/CD direction

`main` is the canonical branch. The old `photosync-suite-v1` branch is not part of this SDK architecture.

The SDK CI workflow builds and typechecks only the reusable packages. Later, release CI can build installers/APKs/IPAs, calculate hashes, generate an update manifest, sign it, publish artifacts, and let clients discover the new version through the same SDK contracts.
