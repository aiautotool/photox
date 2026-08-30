# Hướng dẫn tích hợp PhotoX SDK vào app Mobile và Desktop hiện tại

> Áp dụng cho code SDK trên branch `photox-sdk-v2` và app hiện tại của `main`.
>
> **Nguyên tắc:** chưa xoá/rewrite code cũ. Tích hợp từng lớp bằng adapter/repository, test xong mới chuyển behavior cũ sang SDK.

---

# 1. Kiến trúc thư viện

```text
packages/
├── contracts
├── storage
├── media
├── media-cloud
├── integrity
├── jobs
├── reconciliation
├── catalog-backup
├── replica-policy
├── sync
├── transport
├── update-core
├── image-editor
├── provider-local
├── provider-google-drive
├── provider-telegram
├── desktop-sdk
└── mobile-sdk
```

Phân vai:

```text
contracts       type/contract chung
storage         provider registry + replication execution
media           metadata/index abstraction
media-cloud     control-plane biết mỗi media có bao nhiêu replica và nằm ở đâu
integrity       verify file/replica thật sự còn tốt
jobs            durable queue cho tác vụ dài/retry/checkpoint
reconciliation  đối chiếu catalog với provider thực tế
catalog-backup  backup/restore chính catalog PhotoX
replica-policy  policy nâng cao + provider scoring
providers       nơi thực thi upload/download
image-editor    non-destructive Photo Editor SDK
mobile-sdk      facade mobile
desktop-sdk     facade desktop
```

Kiến trúc đích:

```text
Mobile
  ↓
Transport / Sync
  ↓
Desktop Node
  ├── Media Cloud Catalog
  ├── Durable Job Queue
  ├── Integrity Verification
  ├── Reconciliation
  ├── Catalog Backup / Recovery
  ├── Advanced Replica Policy
  └── Storage Provider Registry
        ├── Local
        ├── Google Drive accounts
        ├── Telegram Bot accounts
        └── provider tương lai
```

**Media Cloud Catalog là nguồn sự thật về vị trí media. Provider chỉ là nơi thực thi lưu trữ.**

---

# 2. Tạo branch tích hợp từ main

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Merge/cherry-pick code từ `photox-sdk-v2` sang branch tích hợp. Không merge thẳng vào `main` trước khi build/test Mobile + Desktop.

Root workspace đã dùng `packages/*`, vì vậy chạy:

```bash
npm install
```

Build các library trước app:

```bash
npm --workspace @photox/contracts run build
npm --workspace @photox/storage run build
npm --workspace @photox/media run build
npm --workspace @photox/media-cloud run build
npm --workspace @photox/integrity run build
npm --workspace @photox/jobs run build
npm --workspace @photox/reconciliation run build
npm --workspace @photox/catalog-backup run build
npm --workspace @photox/replica-policy run build
npm --workspace @photox/sync run build
npm --workspace @photox/transport run build
npm --workspace @photox/image-editor run build
npm --workspace @photox/provider-local run build
npm --workspace @photox/provider-google-drive run build
npm --workspace @photox/provider-telegram run build
npm --workspace @photox/desktop-sdk run build
npm --workspace @photox/mobile-sdk run build
```

---

# 3. Tích hợp Desktop mà không phá code cũ

Không xoá `desktop/electron/main.ts` ngay. Hiện file này đang giữ Mobile API, local index, Google OAuth/Drive, upload/download, replica policy và IPC.

Tạo lớp wiring riêng, ví dụ:

```text
desktop/electron/services/photoxSdk.ts
```

Luồng migration:

```text
legacy main.ts
   ↓ adapter
PhotoX SDK services
   ↓
Catalog / Jobs / Policy / Providers
```

Chuyển từng chức năng một; không chuyển toàn bộ trong một commit.

---

# 4. Provider Local / Google Drive / Telegram

## Local

```ts
photoX.registerStorageProvider(
  new LocalStorageProvider(localStoragePath)
);
```

`localStoragePath` lấy từ Electron config hoặc `app.getPath('userData')`.

## Google Drive

Giữ OAuth/Drive hiện tại, bọc thành `GoogleDriveAdapter` cho `GoogleDriveProvider`.

Replica chuẩn:

```ts
{
  providerId: 'google-drive',
  accountId: 'drive-account-a',
  remoteFileId: '...'
}
```

Replica legacy không có `providerId` được normalize khi đọc thành `google-drive`.

## Telegram Bot

Package:

```text
@photox/provider-telegram
```

Hỗ trợ nhiều bot/account, target chat/channel riêng, Cloud Bot API hoặc Local Bot API Server, media stats, upload/download và health check.

Config account:

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

Không lưu token plaintext trong config/database thường. Production `SecretStore` dùng Keychain/DPAPI/Credential Manager/keyring.

Desktop UI sau này:

```text
Settings > Storage > Telegram Bot
Add / Edit / Enable / Disable / Test / Remove
```

File/video lớn phải dùng streaming/local-path adapter; không đọc file hàng GB vào RAM.

---

# 5. Media Cloud Catalog

Package:

```text
@photox/media-cloud
```

Một media có thể có:

```text
IMG_001.HEIC
├── Local / Mac SSD               VERIFIED
├── Google Drive / Account A      VERIFIED
└── Telegram Bot / Backup Bot 1   VERIFIED
```

Catalog lưu tối thiểu:

```text
assetId
filename
mimeType
sizeBytes
sha256
targetReplicas
replicas[]
```

Replica identity bắt buộc:

```text
replicaId
assetId
providerId
accountId
state
remoteFileId (nếu remote)
```

Health:

```text
protected
under_replicated
degraded
lost
unknown
```

Production cần persistent `MediaCloudRepository`; `MemoryMediaCloudRepository` chỉ dành cho test/dev.

Khuyến nghị database:

```text
media_cloud_assets
media_cloud_replicas
```

Khi Desktop nhận media:

```text
receive media
→ hash/metadata
→ cloudCatalog.registerAsset()
→ attach local replica VERIFIED
→ enqueue remote replication jobs
```

Mỗi upload remote phải cập nhật catalog qua `ReplicationCatalogBridge`:

```text
QUEUED → UPLOADING → UPLOADED → VERIFIED
                         ↘ ERROR
```

Không tính upload thành công là backup tốt cho tới khi được verify.

---

# 6. Integrity Verification Engine

Package:

```text
@photox/integrity
```

Mục tiêu: kiểm tra replica có **thật sự tồn tại và đọc được**, không chỉ dựa vào record trong database.

Các trạng thái:

```text
UNKNOWN
HEALTHY
MISSING
CORRUPTED
UNREADABLE
STALE
```

Adapter provider implement `IntegrityProbe`:

```ts
interface IntegrityProbe {
  probe(target): Promise<{
    exists: boolean;
    readable: boolean;
    sizeBytes?: number;
    sha256?: string;
    checkedAt: string;
  }>;
}
```

Verify:

```ts
const report = await integrity.verify({
  assetId,
  providerId,
  accountId,
  remoteFileId,
  expectedSizeBytes,
  expectedSha256,
});
```

Nếu file mất → `MISSING`.

Nếu đọc không được → `UNREADABLE`.

Nếu size/hash lệch → `CORRUPTED`.

Nếu OK → `HEALTHY`.

Persist report vào database, ví dụ:

```text
integrity_reports
```

Nên lưu:

```text
assetId
replicaId
state
checkedAt
sizeMatches
checksumMatches
message
```

## Restore Verification

`RestoreVerificationService` thực hiện test mạnh hơn:

```text
Download replica về temporary/cache
→ hash SHA256
→ so với original
→ xoá temporary
```

Nên chạy ngẫu nhiên theo lịch để xác nhận backup thật sự restore được.

---

# 7. Durable Job Queue

Package:

```text
@photox/jobs
```

Các tác vụ dài không chạy bằng Promise rời rạc nữa. Dùng durable job:

```text
QUEUED
RUNNING
PAUSED
RETRY_WAIT
COMPLETED
FAILED
CANCELLED
```

Các job nên chuyển vào queue:

```text
media.upload
replica.verify
replica.repair
catalog.reconcile
catalog.backup
catalog.restore
storage.rebalance
media.delete
thumbnail.generate
edit.export
```

Register handler:

```ts
jobs.register('replica.verify', async (payload, ctx) => {
  // verify
  await ctx.checkpoint({ step: 'verified-provider-object' });
});
```

Enqueue:

```ts
await jobs.enqueue('replica.verify', payload, {
  priority: 10,
  maxAttempts: 5,
});
```

Engine đã có retry exponential backoff, checkpoint, pause/resume/cancel.

**Production phải thay `MemoryJobRepository` bằng persistent repository** như SQLite.

Bảng đề xuất:

```text
jobs
job_events (optional)
```

Khi Desktop restart, worker đọc lại `QUEUED` / `RETRY_WAIT` và tiếp tục.

Không để một upload đang chạy mất trạng thái chỉ vì app đóng.

---

# 8. Reconciliation Engine

Package:

```text
@photox/reconciliation
```

Mục tiêu:

```text
Media Cloud Catalog
        ↕
Provider Inventory thực tế
```

Ví dụ catalog nói:

```text
IMG_001 → Drive A / file123 VERIFIED
```

nhưng user đã vào Google Drive xoá `file123` thủ công. Reconciliation phải phát hiện:

```text
MISSING_REMOTE
```

và schedule repair để tạo replica mới.

Issue types:

```text
MISSING_REMOTE
UNKNOWN_REMOTE
STATE_DRIFT
```

`ProviderInventory` được implement riêng theo provider:

```ts
interface ProviderInventory {
  list(providerId, accountId): Promise<ProviderReplicaRef[]>;
}
```

`RepairScheduler` thường được adapter sang `@photox/jobs`:

```text
MISSING_REMOTE
→ enqueue replica.repair
→ AdvancedReplicaPolicyEngine chọn destination
→ provider upload
→ verify
→ catalog VERIFIED
```

Không chạy full reconciliation liên tục. Gợi ý:

```text
startup lightweight check
nightly incremental reconciliation
weekly deeper provider reconciliation
```

Provider API đắt/rate-limited phải dùng paging/checkpoint.

---

# 9. Catalog Backup / Recovery

Package:

```text
@photox/catalog-backup
```

Đây là phần rất quan trọng: nếu laptop hỏng nhưng catalog chỉ nằm local thì rất khó biết file nào nằm ở provider nào.

Catalog phải được backup như một asset hệ thống:

```text
PhotoX Catalog
├── local DB
├── Google Drive account A
└── provider/account khác
```

`CatalogSerializer` chịu trách nhiệm export/import database thành payload snapshot.

Backup:

```ts
await catalogBackup.backup({
  encrypt: true,
  minimumSuccessfulTargets: 2,
});
```

Một snapshot có:

```text
schemaVersion
createdAt
catalogVersion
payload
checksum
encrypted
```

Nếu chưa đủ số destination thành công, service báo `CATALOG_BACKUP_REDUNDANCY_NOT_MET`.

## Encryption

Production nên cung cấp `CatalogCrypto` để encrypt catalog trước upload.

Recovery key không lưu cùng snapshot/provider.

## Disaster Recovery

Luồng máy mới:

```text
Install PhotoX
→ nhập/import recovery credential/key
→ tìm catalog snapshot mới nhất
→ verify snapshot checksum
→ decrypt
→ restore catalog DB
→ load provider configs/credentials theo cơ chế riêng
→ reconciliation toàn hệ thống
→ rebuild local index/cache
→ restore media khi user yêu cầu
```

`CatalogRecoveryService.chooseLatest()` chọn snapshot mới nhất từ các backup target.

**Catalog snapshot checksum phải được verify trước import.**

---

# 10. Advanced Replica Policy + Provider Scoring

Package:

```text
@photox/replica-policy
```

Policy không còn chỉ là `targetReplicas = 2`.

Context có thể gồm:

```text
mediaType
sizeBytes
albumIds
favorite
important
edited
```

Ví dụ rule:

```text
Important media
→ 3 replicas
→ ít nhất 3 accounts
→ ít nhất 2 providers
→ backup original + edit recipe + rendered copy
```

```text
Large video
→ 2 replicas
→ loại provider không phù hợp max object size
```

```text
Edited photo
→ original + editRecipe bắt buộc
→ rendered copy tùy policy
```

Khởi tạo:

```ts
const policy = new AdvancedReplicaPolicyEngine(DEFAULT_PHOTOX_RULES);
const resolved = policy.resolve(context);
```

## Provider Scoring

`ProviderScoringEngine` chấm ứng viên dựa trên:

```text
provider/account health
free bytes
max object size
latency
recent failure rate
account đã được dùng chưa
provider đã được dùng chưa
allow/deny provider
```

Ví dụ:

```text
Drive A        1280
Drive B        1190
Telegram A      940
Drive C FULL       0 / ineligible
```

Storage orchestration lấy ranking cao nhất nhưng vẫn phải đáp ứng minimum distinct account/provider.

**Lưu ý:** rule `large-video` mặc định có thể deny Telegram Cloud; khi dùng Telegram Local Bot API với object size lớn hơn, app có thể cung cấp policy/rule khác thay vì hard-code behavior UI.

---

# 11. Luồng backup hoàn chỉnh sau khi tích hợp

```text
Mobile sends media
        ↓
Desktop receives
        ↓
Hash + metadata
        ↓
MediaCloudCatalog.registerAsset
        ↓
Local replica VERIFIED
        ↓
AdvancedReplicaPolicyEngine.resolve
        ↓
ProviderScoringEngine.rank
        ↓
DurableJobQueue enqueue upload jobs
        ↓
Provider.upload
        ↓
Catalog = UPLOADED
        ↓
IntegrityVerificationEngine.verify
        ↓
Catalog = VERIFIED
        ↓
ReplicaPlanner evaluates protection
        ↓
protected / under_replicated / degraded
```

Nếu remote bị xoá sau này:

```text
Reconciliation
→ MISSING_REMOTE
→ catalog degraded/under-replicated
→ enqueue replica.repair
→ policy + scoring chọn destination mới
→ upload + verify
→ protected trở lại
```

---

# 12. Desktop Cloud Management UI sau này

**Chỉ triển khai UI khi library integration ổn.**

Màn Cloud Overview:

```text
Protection Score: 98%

50,243 media
49,981 Protected
201 Need Backup
41 Degraded
4 Lost/Corrupted
16 Verification Overdue
```

View theo media:

```text
IMG_001.HEIC
Protected • 3 copies
├── Local / Mac SSD
├── Google Drive / A
└── Telegram Bot / Backup 1
```

View theo storage:

```text
Google Drive
├── Account A   22,000 replicas
└── Account B   20,100 replicas

Telegram Bot
├── Bot 1       15,000 replicas
└── Bot 2       10,300 replicas
```

Actions sau này:

```text
Open remote
Download
Verify now
Create another replica
Repair
Move/Rebalance replica
Remove replica
```

Không cho UI tự gọi provider trực tiếp; UI gọi service/orchestrator.

---

# 13. API Desktop đề xuất sau này

Không cần thêm ngay, nhưng khi gắn Mobile/Desktop UI có thể expose:

```text
GET  /api/v1/cloud/summary
GET  /api/v1/cloud/media/:assetId
GET  /api/v1/cloud/media?health=under_replicated
GET  /api/v1/cloud/providers
GET  /api/v1/cloud/jobs
POST /api/v1/cloud/media/:assetId/verify
POST /api/v1/cloud/media/:assetId/repair
POST /api/v1/cloud/reconcile
POST /api/v1/cloud/catalog/backup
```

Không trả credential/token qua API.

---

# 14. Mobile integration

Mobile không cần biết replica nằm Google Drive hay Telegram.

Mobile chỉ hỏi Desktop:

```text
asset status
protection state
available/download
```

Nút Download/Delete/Edit tiếp tục dùng `@photox/mobile-sdk`.

Nếu muốn hiển thị backup status trên mobile, chỉ expose summary:

```text
Protected
Backing up
Needs attention
Offline
```

Không gửi provider secret.

---

# 15. Photo Editor integration

`@photox/image-editor` vẫn là non-destructive.

Persist:

```text
originalAssetId
editedAssetId
editRecipe
presetId
recipeVersion
```

Advanced policy dùng `edited=true` để quyết định:

```text
backup original
backup editRecipe
backup rendered copy hay không
```

Không upload JPEG mới mỗi lần kéo slider.

---

# 16. Database đề xuất

Các persistent repository sau này có thể dùng SQLite/Postgres-compatible abstraction:

```text
media_cloud_assets
media_cloud_replicas
integrity_reports
jobs
job_events
catalog_backup_history
provider_accounts
telegram_accounts
telegram_media
edit_records
```

Credential/token không lưu plaintext trong các bảng trên.

Mọi schema nên có version/migration.

---

# 17. Lịch background khuyến nghị

```text
Realtime
- upload
- upload verification
- repair critical replicas

Mỗi vài giờ
- account/provider health
- lightweight integrity sample

Nightly
- incremental reconciliation
- catalog backup
- protection health recalculation

Weekly
- deeper reconciliation
- random restore verification
- rebalance recommendation
```

Các lịch này sau này phải enqueue vào durable job queue, không chạy trực tiếp trên UI thread.

---

# 18. Thứ tự tích hợp vào main

## Phase 1 — Library only

- merge packages
- build/typecheck
- chưa đổi UI
- implement persistent repositories

## Phase 2 — Catalog

1. MediaCloudRepository SQLite
2. migrate/normalize legacy replicas
3. register new incoming assets
4. attach existing Local/Drive/Telegram replicas

## Phase 3 — Durable jobs

1. SQLite JobRepository
2. worker lifecycle Electron
3. upload job
4. verification job
5. recovery after restart

## Phase 4 — Integrity

1. Local probe
2. Google Drive probe
3. Telegram probe
4. persist reports
5. update catalog health

## Phase 5 — Advanced policy

1. map asset → PolicyContext
2. resolve policy
3. map provider accounts → ProviderCandidate
4. score/rank
5. replication respects diversity rules

## Phase 6 — Reconciliation

1. provider inventory adapters
2. catalog adapter
3. repair scheduler → jobs
4. incremental reconciliation
5. deep reconciliation

## Phase 7 — Catalog backup/recovery

1. serializer DB
2. Google Drive backup target
3. second independent target
4. encryption adapter
5. restore dry-run
6. disaster recovery test

## Phase 8 — UI

Sau khi các engine ổn mới thêm Cloud Overview, Risk Dashboard, Jobs, Integrity/Repair actions.

---

# 19. CI

CI phải build/typecheck các package mới:

```bash
npm --workspace @photox/media-cloud run build
npm --workspace @photox/integrity run build
npm --workspace @photox/jobs run build
npm --workspace @photox/reconciliation run build
npm --workspace @photox/catalog-backup run build
npm --workspace @photox/replica-policy run build
```

và tương ứng `run typecheck`.

Sau đó mới build provider/platform SDK.

---

# 20. Checklist trước khi merge main

## Catalog

- [ ] media biết tất cả replica
- [ ] providerId + accountId + remoteFileId đầy đủ
- [ ] legacy Google replica normalize đúng
- [ ] Telegram replica map đúng bot account
- [ ] restart Desktop không mất catalog

## Integrity

- [ ] missing remote bị phát hiện
- [ ] size mismatch bị phát hiện
- [ ] checksum mismatch thành CORRUPTED
- [ ] unreadable replica không được tính protected
- [ ] restore verification test chạy được

## Jobs

- [ ] restart app không mất QUEUED jobs
- [ ] retry/backoff hoạt động
- [ ] checkpoint persist
- [ ] pause/resume/cancel đúng
- [ ] failed job không làm crash worker

## Reconciliation

- [ ] xóa file thủ công trên Drive được phát hiện
- [ ] provider object không có catalog được report
- [ ] missing replica schedule repair
- [ ] rate limit/paging được xử lý ở adapter

## Catalog Recovery

- [ ] snapshot checksum đúng
- [ ] encrypted snapshot restore được
- [ ] ít nhất 2 backup targets
- [ ] restore trên máy/database mới đã được thử
- [ ] recovery key không nằm cùng provider

## Policy

- [ ] image/video rules đúng
- [ ] large file không chọn account không đủ khả năng
- [ ] important media đạt diversity policy
- [ ] account full/auth error bị loại
- [ ] provider failure rate ảnh hưởng scoring

## Security

- [ ] Telegram token không plaintext
- [ ] Google token không leak API/UI
- [ ] catalog backup có thể encrypt
- [ ] log không chứa credential

---

# 21. Nguyên tắc kiến trúc lâu dài

```text
UI chỉ hiển thị và phát command.
Durable jobs thực thi tác vụ dài.
Media Cloud Catalog là nguồn sự thật về vị trí media.
Provider chỉ thực hiện storage operation.
Upload success chưa phải backup success; phải verify.
Replica không healthy không được tính vào protection target.
Reconciliation phải phát hiện drift giữa catalog và provider.
Catalog cũng phải được backup và restore thử.
Original media immutable.
EditRecipe là nguồn sự thật của chỉnh sửa non-destructive.
Credential tách khỏi config/catalog thường.
Provider mới không được yêu cầu rewrite cloud/catalog core.
Một provider lỗi không được kéo sập toàn bộ hệ thống.
```

Giữ các nguyên tắc này để PhotoX phát triển từ app sync ảnh thành một personal media cloud có khả năng tự kiểm tra, tự phát hiện mất replica, tự sửa redundancy và khôi phục sau sự cố.