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
├── media-cloud
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

Phân vai:

```text
contracts      = type/contract chung
storage        = provider registry + policy + replication execution
media-cloud    = catalog/control-plane biết media đang nằm ở đâu
sync           = queue/orchestration
media          = media metadata/index abstractions
providers      = nơi thực thi lưu/download dữ liệu
image-editor   = non-destructive photo editor SDK
mobile-sdk     = facade cho mobile
desktop-sdk    = facade cho desktop
```

Mục tiêu cuối:

```text
Mobile UI
   ↓
@photox/mobile-sdk
   ↓ HTTP / Tunnel
Desktop API
   ↓
@photox/desktop-sdk
   ├── @photox/storage
   ├── @photox/media-cloud
   └── providers
        ├── Local
        ├── Google Drive
        └── Telegram Bot
```

**Quy tắc quan trọng:** provider không phải nguồn sự thật toàn hệ thống. `@photox/media-cloud` mới là catalog cho biết mỗi media có bao nhiêu bản sao và đang nằm ở đâu.

---

# 2. Chuẩn bị branch tích hợp

Không merge SDK trực tiếp vào `main` khi chưa test.

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Merge/cherry-pick code từ `photox-sdk-v2` vào branch tích hợp.

Root repo đã dùng:

```json
"workspaces": ["mobile", "desktop", "relay", "packages/*"]
```

Cài dependency:

```bash
npm install
```

Build SDK:

```bash
npm --workspace @photox/contracts run build
npm --workspace @photox/storage run build
npm --workspace @photox/media-cloud run build
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

Không xoá `desktop/electron/main.ts` ngay.

File này hiện giữ nhiều logic legacy:

- Mobile HTTP API
- local media index
- Google OAuth
- Google Drive
- quota
- upload/download
- replica policy
- Electron IPC

Tích hợp dần theo adapter:

```text
legacy main.ts
    ↓ adapter/callback
PhotoX Desktop SDK
    ↓
Storage / Media Cloud / Providers
```

Tạo service ví dụ:

```text
desktop/electron/services/photoxSdk.ts
```

Không chuyển tất cả logic trong một commit.

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

Không bỏ OAuth/Drive hiện tại.

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
providerId = 'google-drive';
```

Không bắt buộc migrate toàn database trong một lần.

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

Hỗ trợ:

- nhiều Telegram Bot accounts
- mỗi account có target chat/channel riêng
- enable/disable
- Telegram Cloud Bot API
- Local Bot API Server
- upload/download adapter
- media index/stats theo account
- tham gia replication giống provider khác

## 6.1 Config account

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

Không lưu bot token plaintext vào JSON/database thường.

Production `SecretStore`:

```text
macOS   → Keychain
Windows → Credential Manager / DPAPI
Linux   → secret service/keyring
```

## 6.2 Desktop config UI sau này

```text
Settings
└── Storage
    └── Telegram Bot
        ├── Add Bot
        ├── Edit Bot
        ├── Enable / Disable
        ├── Test Connection
        └── Remove Bot
```

Form:

```text
Name
Bot Token
Chat ID / Channel ID
API Mode
API Base URL (nếu Local Bot API)
Enabled
```

## 6.3 Cloud vs Local Bot API

SDK expose giới hạn bằng config để Storage Policy có thể loại account không phù hợp trước upload.

```text
Cloud Bot API       → file limit thấp hơn
Local Bot API       → phù hợp file/video lớn hơn
```

Video lớn phải dùng streaming/local-path adapter, không đọc toàn bộ file lớn vào RAM.

## 6.4 Telegram stats

`TelegramMediaStatsService` thống kê số media PhotoX đã upload/index theo bot account.

Ví dụ Desktop sau này:

```text
Telegram Bot Storage
12,340 media
9.2 GB indexed

Backup Bot 1
7,000 media
6,200 photos
780 videos
```

Đây là **PhotoX indexed stats**, không phải Telegram quota.

---

# 7. Media Cloud Catalog — quản lý media phân bổ qua provider

Package:

```text
@photox/media-cloud
```

Đây là library dùng để quản lý cloud kiểu Google Photos/Synology: biết **mỗi media có bao nhiêu bản sao, bản sao nào healthy, nằm ở provider/account nào và có thiếu replica hay không**.

`@photox/storage` chịu trách nhiệm thực hiện upload/download. `@photox/media-cloud` chịu trách nhiệm ghi nhận kết quả và trở thành control-plane/source of truth cho vị trí media.

## 7.1 Thành phần

```text
@photox/media-cloud
├── MediaCloudCatalog
├── MediaCloudRepository
├── MemoryMediaCloudRepository
├── MediaCloudStatsService
├── ReplicaPlanner
└── ReplicationCatalogBridge
```

## 7.2 Một media có nhiều replica

Ví dụ:

```text
IMG_001.HEIC
├── Local / Mac SSD                  VERIFIED
├── Google Drive / account-a         VERIFIED
└── Telegram Bot / backup-bot-1      VERIFIED
```

Catalog lưu dạng:

```ts
{
  assetId: 'asset-001',
  filename: 'IMG_001.HEIC',
  sizeBytes: 8_123_456,
  sha256: '...',
  targetReplicas: 2,
  replicas: [
    {
      replicaId: 'replica-local-1',
      assetId: 'asset-001',
      providerId: 'local',
      accountId: 'local-primary',
      state: 'VERIFIED'
    },
    {
      replicaId: 'replica-drive-1',
      assetId: 'asset-001',
      providerId: 'google-drive',
      accountId: 'drive-account-a',
      remoteFileId: '...',
      state: 'VERIFIED'
    },
    {
      replicaId: 'replica-telegram-1',
      assetId: 'asset-001',
      providerId: 'telegram-bot',
      accountId: 'telegram-backup-1',
      remoteFileId: '...',
      state: 'VERIFIED'
    }
  ]
}
```

## 7.3 Replica identity bắt buộc

Mỗi replica phải có tối thiểu:

```text
replicaId
assetId
providerId
accountId
state
```

Remote provider thêm:

```text
remoteFileId
remotePath
webViewLink
uploadedAt
verifiedAt
```

Không dùng `remoteFileId` đơn lẻ làm identity vì hai provider/account có thể dùng namespace khác nhau.

## 7.4 Health model

Catalog trả health:

```text
protected
under_replicated
degraded
lost
unknown
```

Ý nghĩa:

```text
protected
→ đạt đủ số verified replicas theo policy

under_replicated
→ có bản sao nhưng chưa đủ target

degraded
→ vẫn có bản usable nhưng có replica lỗi/offline

lost
→ catalog không biết bản verified usable nào

unknown
→ chưa đủ dữ liệu để kết luận
```

Ví dụ:

```text
Target replicas: 2
Verified: 2
→ protected
```

```text
Target replicas: 2
Verified: 1
→ under_replicated
```

```text
Drive VERIFIED + Telegram ERROR
→ degraded / under-replicated tùy policy
```

## 7.5 Khởi tạo catalog

Desktop tạo persistent repository implementation:

```ts
import {
  MediaCloudCatalog,
  MediaCloudStatsService,
  ReplicaPlanner,
  ReplicationCatalogBridge,
} from '@photox/media-cloud';

const cloudCatalog = new MediaCloudCatalog(mediaCloudRepository, {
  targetReplicas: 2,
  requireDistinctAccounts: true,
  preferDistinctProviders: true,
});

const cloudStats = new MediaCloudStatsService(
  mediaCloudRepository,
  cloudCatalog,
);

const replicaPlanner = new ReplicaPlanner({
  targetReplicas: 2,
  requireDistinctAccounts: true,
  preferDistinctProviders: true,
});

const catalogBridge = new ReplicationCatalogBridge(cloudCatalog);
```

`MemoryMediaCloudRepository` chỉ dùng test/prototype.

Production phải persist vào database desktop.

## 7.6 Register media khi Desktop nhận file

Sau khi Mobile upload media sang Desktop:

```ts
await cloudCatalog.registerAsset({
  assetId: asset.id,
  filename: asset.filename,
  mimeType: asset.mimeType,
  sizeBytes: asset.sizeBytes,
  sha256: asset.sha256,
  createdAt: asset.createdAt,
});
```

Nếu local file được xem là một replica, attach local replica ngay sau khi file được verify/hash thành công.

## 7.7 Cập nhật catalog trong replication pipeline

Flow khuyến nghị:

```text
Asset received
 ↓
registerAsset
 ↓
StoragePolicyEngine chọn destination
 ↓
catalogBridge.queued()
 ↓
provider.upload()
 ↓
catalogBridge.uploaded()
 ↓
verify remote object
 ↓
catalogBridge.verified()
```

Nếu lỗi:

```ts
await catalogBridge.failed(assetId, replicaId, error);
```

Không đánh dấu `VERIFIED` chỉ vì API upload trả success. Nên có bước verify phù hợp provider.

## 7.8 Truy vấn một media đang nằm ở đâu

```ts
const media = await cloudCatalog.get(assetId);
```

UI Desktop có thể render:

```text
IMG_001.HEIC
Protected • 3 verified copies

Locations
✓ Local
  Mac SSD

✓ Google Drive
  user-a@gmail.com
  Open remote file

✓ Telegram Bot
  Backup Bot 1
```

`locations[].webViewLink` có thể dùng cho provider hỗ trợ open remote.

Telegram không bắt buộc có public/web view link.

## 7.9 Truy vấn media thiếu replica

```ts
const rows = await cloudCatalog.list({
  health: 'under_replicated'
});
```

Desktop có thể có Smart View:

```text
Cloud Health
├── Protected
├── Needs Backup
├── Degraded
└── Lost / Missing
```

## 7.10 Replica Planner

```ts
const plan = replicaPlanner.plan(item);
```

Kết quả:

```ts
{
  required: 2,
  verified: 1,
  missing: 1,
  distinctAccounts: 1,
  distinctProviders: 1,
  healthy: false,
  reasons: ['Missing 1 verified replica(s)']
}
```

Planner chỉ đánh giá trạng thái. `StoragePolicyEngine` vẫn là thành phần chọn account/provider để tạo replica mới.

## 7.11 Stats toàn hệ thống

```ts
const stats = await cloudStats.snapshot();
```

Ví dụ:

```ts
{
  mediaCount: 50000,
  protectedMediaCount: 48000,
  underReplicatedMediaCount: 1500,
  degradedMediaCount: 450,
  lostMediaCount: 50,
  verifiedReplicaCount: 112000,
  totalReplicaCount: 115000,
  totalLogicalBytes: 123456789,
  totalReplicaBytes: 290000000,
  providers: [...],
  accounts: [...]
}
```

Phân biệt:

```text
totalLogicalBytes
→ dung lượng media logical/original

totalReplicaBytes
→ tổng dung lượng tất cả bản sao
```

## 7.12 Stats theo provider

Desktop có thể hiển thị:

```text
Cloud Overview

50,000 media
48,000 protected
1,500 need backup
450 degraded
50 lost

Storage locations
Google Drive      42,100 media
Telegram Bot      25,300 media
Local             50,000 media
```

Stats provider không thay thế quota provider. Hai loại số liệu phải hiển thị riêng.

## 7.13 Stats theo account

Ví dụ:

```text
Google Drive
├── account-a@gmail.com    22,000 media
└── account-b@gmail.com    20,100 media

Telegram Bot
├── Backup Bot 1           15,000 media
└── Backup Bot 2           10,300 media
```

Điều này giúp user biết media đang phân bổ ở đâu thay vì chỉ biết provider có tồn tại.

## 7.14 Database đề xuất

Có thể persist dưới schema tương đương:

```text
media_cloud_assets
media_cloud_replicas
```

`media_cloud_assets`:

```text
asset_id PK
filename
mime_type
size_bytes
sha256
target_replicas
created_at
updated_at
metadata_json
```

`media_cloud_replicas`:

```text
replica_id PK
asset_id FK
provider_id
account_id
state
remote_file_id
remote_path
web_view_link
size_bytes
checksum
availability
uploaded_at
verified_at
last_checked_at
last_error_at
message
metadata_json
```

Index nên có:

```text
asset_id
provider_id
account_id
state
(provider_id, account_id)
```

## 7.15 Không duplicate source of truth

Tránh tình trạng:

```text
Google provider có một index
Telegram có một index
Desktop media index có một index
UI tự đoán replica
```

Chuẩn nên là:

```text
Provider-specific repository
→ dùng khi provider cần metadata riêng

MediaCloudRepository
→ nguồn sự thật cross-provider về replica distribution
```

Ví dụ Telegram vẫn giữ `messageId/fileUniqueId` riêng, nhưng replica toàn hệ thống phải được phản ánh vào Media Cloud Catalog.

## 7.16 Reconciliation

Sau này nên có background reconciliation:

```text
MediaCloudCatalog
 ↓
check provider replica
 ↓
exists + checksum/size OK?
 ↓
yes → VERIFIED/online
no  → ERROR/offline
 ↓
ReplicaPlanner
 ↓
thiếu copy?
 ↓
StoragePolicyEngine tạo replacement replica
```

Không cần chạy liên tục; có thể chạy startup, theo lịch hoặc khi provider/account thay đổi.

---

# 8. Storage Policy + Media Cloud

Luồng chuẩn:

```text
MediaCloudCatalog
   ↓ biết đang có replica nào
ReplicaPlanner
   ↓ biết thiếu bao nhiêu
StoragePolicyEngine
   ↓ chọn destination
ReplicationService
   ↓ upload
StorageProvider
   ↓ thực thi
ReplicationCatalogBridge
   ↓ ghi trạng thái về catalog
```

Ví dụ target 2 remote replicas:

```text
Google Drive account A
Telegram Bot account A
```

Hoặc:

```text
Google Drive A
Google Drive B
```

Policy nên ưu tiên account khác nhau và provider khác nhau khi khả dụng.

Một account phải bị bỏ qua nếu:

- disabled
- auth invalid
- health check fail
- không đủ dung lượng
- object vượt provider upload limit
- provider không phù hợp media type/policy

---

# 9. Mobile API Desktop

Giữ API legacy trong migration:

```text
GET  /api/v1/status
GET  /api/v1/library
POST /api/v1/media
GET  /api/v1/media/:key
```

Sau đó bổ sung API read-only cloud info:

```text
GET /api/v1/cloud/stats
GET /api/v1/cloud/media/:assetId
GET /api/v1/cloud/media?health=under_replicated
```

Mobile không cần biết credential/provider secret.

Nếu expose locations cho mobile chỉ trả safe fields:

```text
providerId
providerDisplayName
accountDisplayName
state
verifiedAt
```

Không gửi:

```text
Google OAuth token
Telegram bot token
provider secret config
```

---

# 10. Mobile Download / Delete

Download:

```ts
await sdk.media.download(asset);
```

Desktop khi phục vụ download có thể dùng Media Cloud Catalog để tìm replica fallback:

```text
Local unavailable
 ↓
Google Drive replica
 ↓ fail
Telegram replica
```

Delete:

```ts
await sdk.media.delete(asset, {
  libraryAssetIds: [localAssetId],
  deleteRemote: true,
});
```

Remote delete phải orchestrate qua Desktop và cập nhật catalog sau mỗi replica được xóa.

Khuyến nghị Trash trước hard delete.

---

# 11. Photo Editor Mobile

Photo Editor sử dụng:

```text
@photox/image-editor
```

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

Toolbar đề xuất:

```text
Presets | Adjust | Crop | Retouch | Filters | Effects | Draw | Text
```

Preset non-destructive và vẫn sửa được từng adjustment sau khi apply.

Manual Adjust:

```text
Light | Color | Detail | Effects | Geometry
```

Hỗ trợ recipe cho:

- Exposure/Brightness/Contrast
- Highlights/Shadows/Whites/Blacks
- Temperature/Tint/Vibrance/Saturation
- HSL Color Mixer
- RGB/R/G/B Tone Curve
- Sharpness/Clarity/Texture/Dehaze
- Noise Reduction
- Vignette/Grain/Fade/Bloom/Glow
- Crop/Rotate/Flip/Straighten/Perspective
- Heal/Remove Object/Face operations
- Filter/LUT reference
- Draw/Text/Sticker

---

# 12. Editor History / Draft / Save

Undo/Redo:

```ts
session.undo();
session.redo();
```

Thoát khi dirty:

```text
Discard changes
Save draft
Cancel
```

Save Draft chỉ persist recipe.

Database edit:

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

Quy tắc:

```text
ORIGINAL IMMUTABLE
```

---

# 13. Editor Preview Performance

Không full-render mỗi slider movement.

Ba cấp:

```text
Thumbnail      ~256–512 px
Interactive    ~1080–1600 px
Full Resolution → Save/Export
```

Stale render phải cancel/bỏ kết quả.

Preset thumbnail phải cache.

---

# 14. Desktop Cloud UI sau này

Library đã sẵn sàng để UI Desktop làm khu vực kiểu cloud manager.

Đề xuất navigation:

```text
Library
Sync
Cloud
Storage Accounts
Settings
```

Màn `Cloud`:

```text
┌─────────────────────────────────────────────┐
│ Cloud                                      │
│ 50,000 media • 48,000 protected           │
├─────────────────────────────────────────────┤
│ Protected  Needs Backup  Degraded  Lost    │
├─────────────────────────────────────────────┤
│ IMG_001.HEIC     3 copies      Protected   │
│ IMG_002.JPG      1 / 2         Needs Backup│
│ VID_003.MOV      2 copies      Degraded    │
└─────────────────────────────────────────────┘
```

Media detail:

```text
IMG_001.HEIC
8.1 MB
SHA256 verified

Copies: 3

Local
Mac SSD
Verified

Google Drive
account-a@gmail.com
Verified
Open remote

Telegram Bot
Backup Bot 1
Verified
```

UI chỉ đọc `MediaCloudCatalog` summary; không tự duyệt provider để đếm bản sao.

---

# 15. Storage Accounts UI sau này

Màn riêng quản lý account/provider:

```text
Storage Accounts
├── Local
├── Google Drive
│   ├── Account A
│   └── Account B
└── Telegram Bot
    ├── Backup Bot 1
    └── Backup Bot 2
```

Account screen hiển thị:

```text
status
quota nếu provider có
media count từ MediaCloudStats
verified replica count
last health check
provider-specific config
```

Không trộn quota với indexed media count.

---

# 16. Đồng bộ edit recipe Mobile → Desktop

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

Khi Save Copy tạo asset mới, asset mới phải được register vào Media Cloud Catalog và replication policy áp dụng như media bình thường.

---

# 17. CI/CD

CI SDK phải chạy:

```bash
npm --workspace @photox/contracts run typecheck
npm --workspace @photox/storage run typecheck
npm --workspace @photox/media-cloud run build
npm --workspace @photox/media-cloud run typecheck
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

Sau đó mới build app.

---

# 18. Thứ tự tích hợp khuyến nghị

## Phase 1 — SDK only

- merge packages vào integration branch
- build/typecheck
- chưa đổi UI
- implement persistent repositories

## Phase 2 — Media Cloud Catalog

1. implement persistent `MediaCloudRepository`
2. import/normalize media index cũ
3. register existing local media
4. map legacy Google replicas
5. map Telegram replicas
6. chạy stats/reconciliation thử nghiệm
7. chưa đổi replication behavior

## Phase 3 — Desktop Storage

1. Google Drive legacy adapter
2. Local provider
3. Telegram config/SecretStore
4. register providers
5. wire `ReplicationCatalogBridge`
6. chuyển policy sang StoragePolicyEngine
7. dùng ReplicaPlanner để phát hiện thiếu copy

## Phase 4 — Desktop Cloud UI

1. Cloud overview
2. health filters
3. media replica detail
4. provider/account stats
5. remote open link
6. repair/re-replicate action sau cùng

## Phase 5 — Mobile media actions

1. Download
2. Delete local
3. Delete remote
4. Edit button
5. optional read-only replica info

## Phase 6 — Photo Editor

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

---

# 19. Migration dữ liệu legacy

Không rewrite database cũ ngay.

Tạo migration/normalizer đọc media hiện tại:

```text
legacy media row
 ↓
MediaCloudItem
```

Google replica cũ thiếu providerId:

```ts
providerId = 'google-drive';
```

Tạo stable `replicaId` cho record legacy, ví dụ UUID persist một lần.

Không generate replicaId mới mỗi lần app restart.

Sau khi catalog được xây xong, đối chiếu:

```text
legacy cloudReplicas count
vs
MediaCloudCatalog verified count
```

Chỉ chuyển UI/source-of-truth sau khi số liệu khớp.

---

# 20. Checklist Media Cloud trước khi gắn vào main

- [ ] một asset có thể có nhiều replicas
- [ ] replica luôn có providerId/accountId
- [ ] replicaId stable qua restart
- [ ] local replica được ghi nhận
- [ ] Google replica legacy normalize đúng
- [ ] Telegram replica ghi nhận đúng bot account
- [ ] verified count đúng
- [ ] target replica đúng
- [ ] protected health đúng
- [ ] under-replicated đúng
- [ ] degraded đúng
- [ ] lost đúng
- [ ] stats provider không double-count media sai
- [ ] stats account đúng
- [ ] logical bytes và replica bytes tách riêng
- [ ] delete replica cập nhật catalog
- [ ] upload fail cập nhật ERROR
- [ ] verify thành công mới cập nhật VERIFIED
- [ ] restart Desktop vẫn đọc được toàn catalog
- [ ] provider credential không nằm trong MediaCloudRepository
- [ ] reconciliation không xóa record chỉ vì provider timeout tạm thời
- [ ] một provider lỗi không làm mất visibility replica provider khác

---

# 21. Checklist Telegram

- [ ] token không lưu plaintext
- [ ] nhiều bot accounts
- [ ] enable/disable
- [ ] invalid token/chat không crash
- [ ] upload limit check trước transfer
- [ ] local Bot API custom URL
- [ ] video lớn không load toàn bộ vào RAM
- [ ] upload lưu fileId/messageId
- [ ] Telegram media stats persist
- [ ] Telegram replica phản ánh vào Media Cloud Catalog
- [ ] Telegram không là backup duy nhất mặc định

---

# 22. Checklist Mobile/Desktop chung

Mobile:

- [ ] pairing cũ không mất
- [ ] sync cũ không phá
- [ ] download hoạt động
- [ ] delete permission đúng
- [ ] original editor không overwrite
- [ ] undo/redo
- [ ] Save Draft
- [ ] Save Copy
- [ ] re-edit sau restart

Desktop:

- [ ] Google OAuth cũ hoạt động
- [ ] Drive accounts cũ đọc được
- [ ] media index cũ đọc được
- [ ] target replicas đạt policy
- [ ] fallback download qua replica khác
- [ ] Cloud stats khớp database
- [ ] Cloud detail chỉ đúng location thực tế

SDK:

- [ ] contracts không phụ thuộc Expo/Electron
- [ ] provider không chứa UI
- [ ] media-cloud không phụ thuộc provider cụ thể
- [ ] image-editor không phụ thuộc UI framework
- [ ] tests pass
- [ ] typecheck pass
- [ ] CI pass

---

# 23. Build kiểm tra

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

# 24. Nguyên tắc kiến trúc lâu dài

```text
UI chỉ hiển thị và phát command.
SDK giữ business logic.
Adapter kết nối platform/library/provider.
Provider credential phải tách khỏi config thường.
Original asset luôn immutable.
EditRecipe là nguồn sự thật của chỉnh sửa.
StorageReplica luôn có providerId + accountId + remoteFileId.
MediaCloudCatalog là nguồn sự thật cross-provider về replica distribution.
Storage/Replication thực thi; Media Cloud ghi nhận và báo health.
Mobile và Desktop dùng chung contracts.
Provider mới không được yêu cầu rewrite storage/media-cloud core.
Renderer mới không được yêu cầu rewrite Photo Editor recipe/business logic.
Một provider lỗi không được kéo sập toàn bộ replication pipeline.
Không đánh dấu replica VERIFIED nếu chưa có bước xác minh phù hợp.
```

Giữ các nguyên tắc này để PhotoX có thể mở rộng Google Drive, Telegram Bot, OneDrive, S3, WebDAV, NAS và provider tương lai mà không phải viết lại app hiện tại.
