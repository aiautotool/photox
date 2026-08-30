# @photox/provider-telegram

Telegram Bot storage provider for PhotoX. This package is a library only; it is not wired into the current desktop app.

## Design

- Provider id: `telegram-bot`
- Multiple bot/chat accounts are supported.
- Bot tokens are stored through `SecretStore`; persisted account config stores only `botTokenSecretKey`.
- Media storage metadata is tracked independently through `TelegramMediaRepository`.
- `TelegramMediaStatsService` calculates media count and bytes per account and provider total.
- `TelegramStorageProvider` implements the shared `StorageProvider` contract.
- `TelegramHttpBotApiAdapter` is a default fetch/FormData adapter for normal Bot API usage.
- Large-file implementations can replace the API adapter without changing the provider or desktop UI contract.

## Account config

```ts
{
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
Desktop Settings
  -> TelegramAccountService.save(config, botToken)
  -> config repository stores non-secret fields
  -> secret store stores token
  -> TelegramStorageProvider.listAccounts()
```

Production desktop integration should implement persistent config/media repositories and an OS-backed secret store (Keychain/Credential Manager or equivalent).

## Stats

```ts
const stats = await telegramStats.getStats({
  'telegram-backup-1': 'Telegram Backup 1'
});
```

Returns total media/bytes and per-account image/video/other counts.

## Telegram Bot API limits

The standard hosted Bot API has smaller upload/download limits than a Local Bot API Server. The provider exposes configurable `uploadLimitBytes` and `downloadLimitBytes` so PhotoX storage policy can reject an account before starting an unsupported transfer.

Do not treat Telegram as the only backup replica. Keep PhotoX replication policy requiring multiple independent replicas/providers.
