# @photox/provider-telegram

Telegram Bot storage provider for PhotoX. This package is a library only; it is not wired into the current desktop app.

## Design

- Provider id: `telegram-bot`
- Multiple bot/chat accounts are supported per workspace.
- Every `TelegramAccountService` is bound to one `workspaceId`; list/resolve/remove cannot cross that boundary.
- Account config identity is `(workspaceId, accountId)`, so two workspaces may safely use the same account ID.
- Bot tokens are stored through `SecretStore`; the service namespaces the physical secret key by workspace before reading/writing it, so identical logical `botTokenSecretKey` values in different workspaces do not collide.
- Media storage metadata is tracked independently through `TelegramMediaRepository` and every row carries `workspaceId`.
- `TelegramMediaStatsService` is workspace-bound and calculates media count and bytes only for that workspace.
- `TelegramStorageProvider` implements the shared `StorageProvider` contract and writes media metadata using the account service workspace boundary.
- `TelegramHttpBotApiAdapter` is a default fetch/FormData adapter for normal Bot API usage.
- Large-file implementations can replace the API adapter without changing the provider or desktop UI contract.

## Account config

```ts
{
  workspaceId: 'workspace-personal',
  accountId: 'telegram-backup-1',
  displayName: 'Telegram Backup 1',
  chatId: '-1001234567890',
  botTokenSecretKey: 'telegram.bot.telegram-backup-1',
  enabled: true,
  apiMode: 'cloud'
}
```

For Local Bot API Server:

```ts
{
  workspaceId: 'workspace-personal',
  accountId: 'telegram-large-video',
  displayName: 'Telegram Large Video',
  chatId: '-1001234567890',
  botTokenSecretKey: 'telegram.bot.telegram-large-video',
  enabled: true,
  apiMode: 'local-bot-api',
  apiBaseUrl: 'http://127.0.0.1:8081'
}
```

## Desktop config flow

```text
Desktop workspace
  -> new TelegramAccountService(configStore, secretStore, workspaceId)
  -> TelegramAccountService.save(config, botToken)
  -> config repository stores workspace-owned non-secret fields
  -> secret store stores the token under a workspace-namespaced physical key
  -> TelegramStorageProvider.listAccounts()
```

Production desktop integration should implement a durable workspace-scoped config/media repository and an OS-backed secret store (Keychain/Credential Manager or equivalent). Do not persist raw bot tokens in normal provider config, logs, audit payloads or Web API responses.

## Stats

```ts
const stats = await new TelegramMediaStatsService(mediaRepository, workspaceId).getStats({
  'telegram-backup-1': 'Telegram Backup 1'
});
```

Returns total media/bytes and per-account image/video/other counts for only the bound workspace.

## Telegram Bot API limits

The standard hosted Bot API has smaller upload/download limits than a Local Bot API Server. The provider exposes configurable `uploadLimitBytes` and `downloadLimitBytes` so PhotoX storage policy can reject an account before starting an unsupported transfer.

Do not treat Telegram as the only backup replica. Keep PhotoX replication policy requiring multiple independent replicas/providers.
