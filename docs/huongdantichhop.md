# Hướng dẫn tích hợp PhotoX SDK vào app Mobile và Desktop hiện tại

> Tài liệu này mô tả cách tích hợp các thư viện trên branch `photox-sdk-v2` vào code hiện tại của `main`.
>
> **Nguyên tắc bắt buộc:** chưa xoá/rewrite code cũ. Tích hợp theo adapter, chuyển từng chức năng một, test xong mới thay implementation cũ.

---

# 1. Kiến trúc SDK hiện có

```text
packages/
├── contracts
├── storage
├── sync
├── media
├── transport
├── update-core
├── provider-local
├── provider-google-drive
├── provider-telegram
├── desktop-sdk
├── mobile-sdk
└── image-editor
```

Mục tiêu cuối:

```text
Mobile UI
   ↓
@photox/mobile-sdk
   ↓
media / transport / image-editor
   ↓ HTTP / Tunnel
Desktop API
   ↓
@photox/desktop-sdk
   ↓
storage / sync / providers
   ↓
Local / Google Drive / Telegram Bot / provider tương lai
```

`StorageProvider` là contract chung. UI không được chứa logic riêng cho Google Drive hay Telegram.

---

# 2. Chuẩn bị branch tích hợp

Không merge SDK trực tiếp vào `main` khi chưa test.

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Sau đó merge/cherry-pick code từ `photox-sdk-v2`.

Root repo đã có:

```json
"workspaces": ["mobile", "desktop", "relay", "packages/*"]
```

Chạy:

```bash
npm install
```

Build SDK:

```bash
npm --workspace @photox/contracts run build
npm --workspace @photox/storage run build
npm --workspace @photox/sync run build
npm --workspace @photox/media run build
npm --workspace @photox/transport run build
npm --workspace @photox/update-core run build
npm --workspace @photox/image-editor run build
npm --workspace @photox/provider-local run build
npm --workspace @photox/provider-google-drive run build
npm --workspace @photox/provider-telegram run build
npm --workspace @photox/desktop-sdk run build
npm --workspace @photox/mobile-sdk run build
```

---

# 3. Tích hợp Desktop SDK

Không xoá `desktop/electron/main.ts` trong bước đầu.

File này đang giữ nhiều logic legacy:

- Mobile HTTP API
- local media index
- Google OAuth
- Google Drive
- quota
- upload/download
- replica policy
- Electron IPC

Tích hợp theo hướng:

```text
legacy main.ts
    ↓ adapter/callback
PhotoX Desktop SDK
    ↓
StorageProviderRegistry
```

Tạo ví dụ:

```text
desktop/electron/services/photoxSdk.ts
```

```ts
import { PhotoXDesktopSDK } from '@photox/desktop-sdk';

export const photoX = new PhotoXDesktopSDK();
```

---

# 4. Local Storage Provider

```ts
import { LocalStorageProvider } from '@photox/provider-local';

photoX.registerStorageProvider(
  new LocalStorageProvider(localStoragePath)
);
```

`localStoragePath` nên lấy từ Electron config hoặc `app.getPath('userData')`.

Không hard-code path production.

---

# 5. Google Drive Provider

Không bỏ Google OAuth/Drive hiện tại.

Bọc code cũ bằng adapter:

```text
GoogleDriveProvider
       ↓
GoogleDriveAdapter
       ↓
Google OAuth + @photosync/google-drive hiện tại
```

Adapter map:

- list accounts
- quota
- upload
- download
- webViewLink
- health check
- remove account nếu hỗ trợ

Replica chuẩn:

```ts
{
  providerId: 'google-drive',
  accountId: 'drive-account-a',
  remoteFileId: '...'
}
```

Record legacy không có `providerId` được normalize khi đọc:

```ts
providerId = 'google-drive'
```

Không cần migrate toàn database ngay lập tức.

---

# 6. Telegram Bot Storage Provider

Package:

```text
@photox/provider-telegram
```

Provider ID:

```text
telegram-bot
```

Mục tiêu:

- lưu ảnh/video qua Telegram Bot
- nhiều bot/account giống Google Drive
- mỗi account dùng một bot token + target chat/channel
- desktop có config riêng cho từng Telegram account
- theo dõi số media đã lưu theo account
- theo dõi tổng số media và tổng bytes
- tham gia StoragePolicy/ReplicationService giống provider khác
- không để UI biết chi tiết Telegram Bot API

## 6.1 Thành phần thư viện

```text
provider-telegram/
├── TelegramStorageProvider
├── TelegramAccountService
├── TelegramHttpBotApiAdapter
├── TelegramMediaStatsService
├── TelegramConfigStore
├── TelegramMediaRepository
├── SecretStore
└── contracts/types
```

## 6.2 Config nhiều Telegram account

Mỗi account có config dạng:

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

Account khác:

```ts
{
  accountId: 'telegram-backup-2',
  displayName: 'Telegram Backup 2',
  chatId: '-1009876543210',
  botTokenSecretKey: 'telegram.bot.telegram-backup-2',
  enabled: true,
  apiMode: 'cloud'
}
```

Có thể đăng ký nhiều account đồng thời.

## 6.3 Không lưu bot token plaintext trong config

Desktop config chỉ persist:

```text
botTokenSecretKey
```

Bot token thật đi qua `SecretStore`.

Production nên implement SecretStore bằng:

```text
macOS → Keychain
Windows → Credential Manager / DPAPI
Linux → secret service/keyring
```

Không ghi bot token vào JSON/log/database plaintext.

## 6.4 Lưu config từ Desktop

UI sau này nên có:

```text
Settings
└── Storage
    └── Telegram Bot
        ├── Add Bot
        ├── Edit Bot
        ├── Enable/Disable
        ├── Test Connection
        └── Remove Bot
```

Form:

```text
Name
Bot Token
Chat ID / Channel ID
API Mode
  - Telegram Cloud
  - Local Bot API Server
API Base URL (nếu local)
Enabled
```

Khi user bấm Save:

```ts
await telegramAccounts.save(
  {
    accountId,
    displayName,
    chatId,
    botTokenSecretKey,
    enabled: true,
    apiMode: 'cloud'
  },
  botToken
);
```

Sau đó test:

```ts
const account = await telegramAccounts.resolve(accountId);
const identity = await telegramApi.verifyBot(account);
```

Nếu `getMe` fail thì UI báo account invalid nhưng không crash app.

## 6.5 Telegram Cloud vs Local Bot API Server

Telegram Bot API cloud có giới hạn file thấp hơn local server.

Provider đã có config:

```text
uploadLimitBytes
downloadLimitBytes
apiMode
apiBaseUrl
```

Cloud defaults trong SDK:

```text
upload ~50 MB
download ~20 MB
```

Local Bot API Server mặc định trong SDK:

```text
upload ~2000 MB
```

Khi dùng Local Bot API Server:

```ts
{
  apiMode: 'local-bot-api',
  apiBaseUrl: 'http://127.0.0.1:8081'
}
```

Video lớn không nên dùng HTTP adapter đọc toàn bộ file vào RAM. Nên implement adapter streaming/local-path riêng cho desktop và inject vào `TelegramStorageProvider`.

## 6.6 Khởi tạo Telegram provider

Ví dụ wiring sau này:

```ts
import {
  TelegramAccountService,
  TelegramStorageProvider,
  TelegramHttpBotApiAdapter,
  TelegramMediaStatsService,
} from '@photox/provider-telegram';

const telegramAccounts = new TelegramAccountService(
  telegramConfigStore,
  desktopSecretStore
);

const telegramMedia = telegramMediaRepository;

const telegramApi = new TelegramHttpBotApiAdapter({
  loadFile: loadDesktopFile,
});

const telegramProvider = new TelegramStorageProvider(
  telegramAccounts,
  telegramApi,
  telegramMedia
);

photoX.registerStorageProvider(telegramProvider);
```

Không register provider nếu feature đang disabled toàn cục.

## 6.7 Telegram replica identity

Khi upload thành công:

```ts
{
  providerId: 'telegram-bot',
  accountId: 'telegram-backup-1',
  remoteFileId: '<telegram file_id>',
  metadata: {
    telegramMessageId: 12345,
    telegramFileUniqueId: '...',
    telegramChatId: '-100...'
  }
}
```

`file_id` thuộc bot cụ thể, vì vậy luôn phải giữ `accountId` cùng `remoteFileId`.

Không được dùng file_id của bot A bằng bot B.

## 6.8 Thống kê media Telegram trên Desktop

Library đã có:

```text
TelegramMediaRepository
TelegramMediaStatsService
```

Mỗi upload thành công sẽ lưu metadata index:

```ts
{
  accountId,
  chatId,
  messageId,
  fileId,
  fileUniqueId,
  filename,
  mimeType,
  mediaType,
  sizeBytes,
  sha256,
  storedAt,
  sourceKey
}
```

Lấy stats:

```ts
const stats = await telegramStats.getStats(displayNames);
```

Kết quả dạng:

```ts
{
  providerId: 'telegram-bot',
  totalMedia: 12340,
  totalBytes: 9876543210,
  accounts: [
    {
      accountId: 'telegram-backup-1',
      mediaCount: 7000,
      imageCount: 6200,
      videoCount: 780,
      otherCount: 20,
      totalBytes: 5000000000,
      lastStoredAt: '...'
    }
  ]
}
```

Desktop UI sau này nên hiển thị card:

```text
Telegram Bot Storage
12,340 media
9.2 GB indexed

Telegram Backup 1
7,000 media
6,200 photos
780 videos

Telegram Backup 2
5,340 media
```

Lưu ý: đây là số liệu **PhotoX đã index/upload**, không phải quota Telegram chính thức.

## 6.9 Persistent repositories cho Desktop

Library có Memory repositories phục vụ test/dev.

Khi gắn thật vào desktop phải implement persistent:

```text
TelegramConfigStore
TelegramMediaRepository
SecretStore
```

Khuyến nghị database:

```text
telegram_accounts
telegram_media
```

Không lưu token trong bảng account.

## 6.10 Telegram không phải bản backup duy nhất

Không đặt Telegram là replica duy nhất.

Khuyến nghị:

```text
Local
+ Google Drive A
+ Telegram Bot A
```

hoặc:

```text
Google Drive A
+ Google Drive B
+ Telegram Bot A
```

Telegram nên được xem là provider bổ sung/archive.

---

# 7. Storage Policy sau khi có Telegram

Storage engine vẫn chọn provider/account, không UI.

Ví dụ target 2 remote replicas:

```text
Asset
 ↓
Google Drive account A
 ↓
Telegram Bot account A
```

Hoặc:

```text
Google Drive A
Google Drive B
```

Policy nên ưu tiên provider khác nhau nếu khả dụng.

Một account phải bị loại trước upload nếu:

- disabled
- auth invalid
- health check fail
- file lớn hơn configured upload limit
- provider không phù hợp media type/policy

Sau này nên bổ sung `maxObjectSizeBytes` vào candidate scoring chung để StoragePolicyEngine không phải thử upload rồi mới fail.

---

# 8. Mobile API Desktop

Giữ API legacy trong migration:

```text
GET  /api/v1/status
GET  /api/v1/library
POST /api/v1/media
GET  /api/v1/media/:key
```

Chuyển backend từng route:

1. status
2. library
3. media download
4. media upload
5. storage providers
6. delete
7. edit recipe sync

Không đổi mobile protocol và desktop backend cùng lúc.

Khi expose provider info cho mobile, không bao giờ gửi bot token.

---

# 9. Tích hợp Mobile SDK

Tạo:

```text
mobile/src/services/photoxSdk.ts
```

Pairing credentials dùng Expo SecureStore thông qua adapter:

```ts
import * as SecureStore from 'expo-secure-store';

export const secureStoreAdapter = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
```

Khởi động:

```ts
await sdk.restorePairing();
```

Pair lần đầu:

```ts
await sdk.pair(credentials);
```

---

# 10. Mobile Download / Delete

Download:

```ts
await sdk.media.download(asset);
```

Delete:

```ts
await sdk.media.delete(asset, {
  libraryAssetIds: [localAssetId],
  deleteRemote: true,
});
```

Remote delete phải qua desktop/provider orchestration.

Không để mobile biết ảnh đang nằm ở Google Drive hay Telegram.

Khuyến nghị Trash trước hard delete:

```text
Delete
 ↓
PhotoX Trash
 ↓ 30 days
Permanent Delete
```

---

# 11. Photo Editor Mobile

Kiến trúc:

```text
Photo Editor Screen
       ↓
PhotoEditorSDK
       ↓
PresetEngine
AdjustmentEngine
CropEngine
RetouchEngine
SmartPresetEngine
HistoryEngine
ExportEngine
       ↓
RendererAdapter
```

Khởi tạo:

```ts
const editor = new PhotoEditorSDK({
  renderer,
  sceneAnalyzer,
});
```

Session:

```ts
const session = editor.createSession({
  uri: asset.uri,
  width: asset.width,
  height: asset.height,
});
```

UI mobile:

```text
┌───────────────────────────────────┐
│ ×        Edit       Compare Save  │
├───────────────────────────────────┤
│                                   │
│             CANVAS                │
│                                   │
├───────────────────────────────────┤
│ ↶   ↷     Edited • adjustments   │
├───────────────────────────────────┤
│ dynamic editor panel              │
├───────────────────────────────────┤
│Preset Adjust Crop Retouch Filter… │
└───────────────────────────────────┘
```

Canvas:

- pinch zoom
- double tap zoom
- pan
- hold Before
- Compare
- crop mode

Gesture là UI state, không persist vào recipe.

---

# 12. Preset / Smart Preset

Preset đứng đầu toolbar.

```ts
const presets = editor.presets.list();
editor.presets.apply(session, presetId, intensity);
```

Preset non-destructive: apply thành adjustment operations.

Smart Preset:

```ts
const recommendations = await editor.smartPresets?.recommend(source, 3);
```

Scene:

```text
portrait
sky
food
night
indoor
document
landscape
```

Model AI đi qua `SceneAnalyzer`, không hard-code CoreML/TFLite vào core.

---

# 13. Manual Adjust

Nhóm UI:

```text
Light | Color | Detail | Effects | Geometry
```

Light:

```text
Exposure
Brightness
Contrast
Highlights
Shadows
Whites
Blacks
Tone Curve
```

Color:

```text
Temperature
Tint
Vibrance
Saturation
HSL / Color Mixer
```

HSL:

```text
Red Orange Yellow Green Aqua Blue Purple Magenta
Hue / Saturation / Luminance
```

Detail:

```text
Sharpness
Clarity
Texture
Dehaze
Noise Reduction
Color Noise Reduction
```

Effects:

```text
Vignette
Grain
Fade
Bloom
Glow
```

---

# 14. Crop / Geometry

Ratio:

```text
Free Original 1:1 4:3 3:4 16:9 9:16
```

Actions:

```text
Rotate
Flip Horizontal
Flip Vertical
Straighten
Perspective Vertical
Perspective Horizontal
```

Grid UI-only:

```text
Rule of thirds
Golden ratio
Center
```

---

# 15. Retouch / Filter

Retouch:

```text
Heal
Remove Object
Face
```

Face:

```text
Skin Smooth
Skin Tone
Face Brightness
Teeth Whitening
Eye Brightness
Eye Detail
```

AI output phải lưu operation/mask/reference cần thiết để re-edit.

Filter khác Preset:

```text
Preset = nhiều adjustment
Filter = LUT/color transformation
```

LUT recipe chỉ lưu reference:

```ts
{
  lutId,
  version,
  intensity
}
```

Không nhúng `.cube` binary vào recipe.

---

# 16. History / Draft

Undo/Redo:

```ts
session.undo();
session.redo();
```

Nếu thoát khi dirty:

```text
Discard changes
Save draft
Cancel
```

Save Draft chỉ persist recipe, không cần full-resolution render.

---

# 17. Save / Export

Save Copy:

```text
EditRecipe
 ↓
ExportEngine
 ↓
RendererAdapter
 ↓
new file
 ↓
Media Library
 ↓
PhotoX DB
```

Không overwrite original.

Export:

```text
Resolution: Original / 4K / 2K / Custom
Format: JPEG / PNG / HEIC / WebP
Quality: 60–100
Metadata: Keep EXIF / Remove location / Remove all
Color: sRGB / Display P3
```

---

# 18. Non-destructive database

Persist:

```ts
{
  originalAssetId,
  editedAssetId,
  recipe,
  presetId,
  createdAt,
  updatedAt
}
```

Có thể thêm:

```text
recipeVersion
rendererVersion
previewAssetId
lastExportPreset
syncState
```

Quy tắc:

```text
ORIGINAL IMMUTABLE
```

---

# 19. Sync edit recipe Mobile → Desktop

```text
Mobile Edit
 ↓
EditRecipe JSON
 ↓
Desktop
 ↓
EditRepository
```

Không upload JPEG mới sau mỗi slider movement.

Chỉ render/upload bản mới khi Save hoặc policy yêu cầu.

---

# 20. Preview performance

Ba cấp render:

```text
Thumbnail ~256–512 px
Interactive ~1080–1600 px
Full Resolution → Save/Export
```

Mỗi render có request ID.

Stale render phải cancel hoặc bỏ kết quả.

Preset thumbnail cache key:

```text
assetId
recipeVersion
presetId
presetVersion
intensityBucket
```

---

# 21. Desktop Photo Editor

Mobile và Desktop dùng chung:

```text
@photox/image-editor
EditRecipe
```

```text
Mobile Editor UI ─┐
                  ├→ PhotoEditorSDK → EditRecipe
Desktop Editor UI ┘
```

Desktop renderer implement `RendererAdapter` bằng WebGL/WebGPU/WASM/native/engine phù hợp.

---

# 22. CI/CD

CI trước app build:

```bash
npm --workspace @photox/contracts run typecheck
npm --workspace @photox/storage run typecheck
npm --workspace @photox/sync run typecheck
npm --workspace @photox/media run typecheck
npm --workspace @photox/image-editor run build
npm --workspace @photox/image-editor test
npm --workspace @photox/image-editor run typecheck
npm --workspace @photox/provider-local run typecheck
npm --workspace @photox/provider-google-drive run typecheck
npm --workspace @photox/provider-telegram run typecheck
npm --workspace @photox/desktop-sdk run typecheck
npm --workspace @photox/mobile-sdk run typecheck
```

Update core chỉ check manifest/version/artifact/integrity.

Native installer thuộc platform adapter riêng.

iOS update phải qua cơ chế được Apple cho phép.

---

# 23. Thứ tự tích hợp khuyến nghị

## Phase 1 — SDK only

- merge packages vào integration branch
- build/typecheck
- tạo persistent adapters
- chưa đổi UI

## Phase 2 — Mobile media actions

1. Download
2. Delete local
3. Delete remote
4. Edit button

## Phase 3 — Photo Editor

1. Canvas
2. Session
3. Before/After
4. Undo/Redo
5. Presets
6. Adjust
7. Crop
8. Save Copy
9. HSL/Tone Curve
10. Retouch/AI

## Phase 4 — Desktop storage

1. Google Drive legacy adapter
2. Local provider
3. Telegram config repositories
4. Telegram SecretStore
5. Telegram Bot API adapter
6. register Telegram provider
7. Telegram stats UI
8. StoragePolicyEngine
9. ReplicationService

## Phase 5 — Edit persistence

1. EditRepository Mobile
2. EditRepository Desktop
3. Draft
4. Recipe sync
5. preview cache

---

# 24. Checklist Telegram trước khi gắn vào main

- [ ] Bot token không lưu plaintext config
- [ ] Add nhiều Telegram accounts
- [ ] Edit account
- [ ] Enable/disable account
- [ ] Test connection
- [ ] Invalid token không crash desktop
- [ ] Invalid chat ID báo lỗi rõ
- [ ] Cloud upload limit được check trước transfer
- [ ] Local Bot API mode hỗ trợ custom URL
- [ ] File lớn dùng streaming/local adapter, không đọc 2GB vào RAM
- [ ] Upload trả về file_id/messageId
- [ ] Replica lưu providerId + accountId + fileId
- [ ] Media repository persist sau upload thành công
- [ ] Stats count đúng ảnh/video/other
- [ ] Stats tổng bytes đúng
- [ ] Restart desktop vẫn đọc lại account/stats
- [ ] Telegram account lỗi không làm block Google Drive account khác
- [ ] Storage policy fallback provider khác khi Telegram fail
- [ ] Không dùng Telegram làm bản backup duy nhất

---

# 25. Checklist Mobile/Desktop chung

Mobile:

- [ ] pairing cũ không mất
- [ ] sync cũ không bị phá
- [ ] download hoạt động
- [ ] delete permissions đúng
- [ ] original không overwrite
- [ ] undo/redo
- [ ] Save Draft
- [ ] Save Copy
- [ ] re-edit sau restart
- [ ] preview không block UI thread

Desktop:

- [ ] Google OAuth cũ hoạt động
- [ ] Drive accounts cũ đọc được
- [ ] media index cũ đọc được
- [ ] replica legacy normalize
- [ ] local provider hoạt động
- [ ] Telegram provider hoạt động độc lập
- [ ] target replicas đạt policy
- [ ] fallback replica download

SDK:

- [ ] contracts không phụ thuộc Expo/Electron
- [ ] provider không chứa UI
- [ ] token không leak qua provider metadata/API
- [ ] image-editor không phụ thuộc UI framework
- [ ] recipe có version
- [ ] tests pass
- [ ] typecheck pass
- [ ] CI pass

Build:

```bash
./scripts/build-mobile.sh ios
./scripts/build-mobile.sh android
./scripts/build-desktop.sh mac-arm64
```

Cài iPhone thật:

```bash
./scripts/install-ios-device.sh
```

---

# 26. Nguyên tắc kiến trúc lâu dài

```text
UI chỉ hiển thị và phát command.
SDK giữ business logic.
Adapter kết nối platform/library/provider.
Provider credential phải tách khỏi config thường.
Original asset luôn immutable.
EditRecipe là nguồn sự thật của chỉnh sửa.
StorageReplica luôn có providerId + accountId + remoteFileId.
Mobile và Desktop dùng chung contracts.
Provider mới không được yêu cầu rewrite storage core.
Renderer mới không được yêu cầu rewrite Photo Editor recipe/business logic.
Một provider lỗi không được kéo sập toàn bộ replication pipeline.
```

Giữ các nguyên tắc này để PhotoX có thể mở rộng Google Drive, Telegram Bot, OneDrive, S3, WebDAV, NAS, renderer và AI model mà không phải viết lại app hiện tại.
