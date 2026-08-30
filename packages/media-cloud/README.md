# @photox/media-cloud

Provider-neutral media cloud catalog for PhotoX.

This package does not upload files. `@photox/storage` and provider packages perform storage operations. `@photox/media-cloud` records where every media asset is stored and exposes cloud-style visibility for desktop/mobile UI.

## Responsibilities

- one media asset -> many replicas
- replica location by provider/account
- verified/degraded/under-replicated/lost health
- target replica count
- cloud statistics by provider and account
- logical bytes vs replica bytes
- query media by provider/account/health/text
- replica planning
- persistent repository contract

## Replica identity

Always persist:

```ts
{
  replicaId: 'replica-...',
  assetId: 'asset-...',
  providerId: 'google-drive',
  accountId: 'drive-account-a',
  remoteFileId: 'remote-id',
  state: 'VERIFIED'
}
```

The same asset may contain replicas such as:

```text
asset-001
├── Local / Mac SSD
├── Google Drive / Account A
└── Telegram Bot / Backup Bot 1
```

## Health

- `protected`: verified replica target satisfied
- `under_replicated`: not enough verified copies
- `degraded`: copies exist but at least one location is unhealthy/unavailable
- `lost`: no usable verified copy known
- `unknown`: state cannot yet be established

## Persistence

`MemoryMediaCloudRepository` is for tests/prototypes. Desktop integration should implement `MediaCloudRepository` using the existing PhotoX database/index.

Do not make provider packages the source of truth for global media distribution. The cloud catalog is the control-plane source of truth; providers are execution/storage backends.
