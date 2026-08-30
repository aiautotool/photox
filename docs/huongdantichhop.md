# Hướng dẫn tích hợp PhotoX SDK vào app Mobile và Desktop hiện tại

> Áp dụng cho SDK trên branch `photox-sdk-v2` và app hiện tại của `main`.
>
> **Nguyên tắc:** thư viện trước, wiring sau. Không xoá/rewrite code cũ; tích hợp từng lớp bằng adapter/repository rồi mới thay behavior hiện tại.

---

# 1. Kiến trúc thư viện

```text
packages/
├── contracts
├── storage
├── media
├── media-cloud
├── media-api
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
media-cloud     source of truth: media có bao nhiêu replica và nằm ở đâu
media-api       DTO/query/content/auth contract cho Mobile ↔ Desktop API
integrity       verify replica còn tồn tại/đọc được/hash đúng
jobs            durable queue, retry, checkpoint, pause/resume
reconciliation  đối chiếu catalog với provider thực tế
catalog-backup  backup/restore catalog PhotoX
replica-policy  policy nâng cao + provider scoring
providers       nơi thực thi upload/download
image-editor    non-destructive editor SDK
mobile-sdk      facade mobile
desktop-sdk     facade desktop
```

Kiến trúc đích:

```text
Mobile UI
   ↓
@photox/mobile-sdk
   ↓ Bearer access token
HTTP / LAN / Tunnel
   ↓
@photox/media-api
   ↓
Desktop services
   ├── Media index
   ├── Media Cloud Catalog
   ├── Integrity
   ├── Jobs
   ├── Reconciliation
   ├── Catalog Backup
   ├── Replica Policy
   └── Provider Registry
        ├── Local
        ├── Google Drive
        └── Telegram Bot
```

**Provider không phải source of truth. `@photox/media-cloud` mới là nguồn sự thật về vị trí replica. `@photox/media-api` là public contract cho UI/client.**

---

# 2. Chuẩn bị tích hợp

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Merge/cherry-pick từ `photox-sdk-v2`, sau đó:

```bash
npm install
npm --workspace @photox/contracts run build
npm --workspace @photox/storage run build
npm --workspace @photox/media run build
npm --workspace @photox/media-cloud run build
npm --workspace @photox/media-api run build
npm --workspace @photox/integrity run build
npm --workspace @photox/jobs run build
npm --workspace @photox/reconciliation run build
npm --workspace @photox/catalog-backup run build
npm --workspace @photox/replica-policy run build
npm --workspace @photox/provider-local run build
npm --workspace @photox/provider-google-drive run build
npm --workspace @photox/provider-telegram run build
npm --workspace @photox/image-editor run build
npm --workspace @photox/desktop-sdk run build
npm --workspace @photox/mobile-sdk run build
```

---

# 3. Desktop wiring — không phá code cũ

Không xoá `desktop/electron/main.ts` ở giai đoạn đầu.

Tạo wiring riêng:

```text
desktop/electron/services/photoxSdk.ts
```

Migration:

```text
legacy main.ts
   ↓ adapter
PhotoX SDK
   ↓
Media API / Catalog / Jobs / Policy / Providers
```

Chuyển từng route/service một, không đổi toàn hệ thống cùng lúc.

---

# 4. Storage Providers

## Local

`@photox/provider-local` dùng path lấy từ Electron config hoặc `app.getPath('userData')`.

## Google Drive

Giữ OAuth/Drive hiện tại, bọc bằng adapter cho `GoogleDriveProvider`.

Replica chuẩn:

```ts
{
  providerId: 'google-drive',
  accountId: 'drive-account-a',
  remoteFileId: '...'
}
```

Legacy replica không có `providerId` được normalize khi đọc thành `google-drive`.

## Telegram Bot

Package:

```text
@photox/provider-telegram
```

Hỗ trợ nhiều bot/account, mỗi bot có `chatId`, Cloud Bot API hoặc Local Bot API Server, health check và media stats.

Config chỉ lưu reference tới secret:

```ts
{
  accountId: 'telegram-backup-1',
  displayName: 'Telegram Backup 1',
  chatId: '-100...',
  botTokenSecretKey: 'telegram.bot.telegram-backup-1',
  enabled: true,
  apiMode: 'cloud'
}
```

Token thật phải nằm trong Keychain / Credential Manager / DPAPI / keyring, không lưu plaintext trong DB/config/log.

---

# 5. Media Cloud Catalog

Package:

```text
@photox/media-cloud
```

Ví dụ:

```text
IMG_001.HEIC
├── Local / Mac SSD               VERIFIED
├── Google Drive / Account A      VERIFIED
└── Telegram Bot / Backup Bot 1   VERIFIED
```

Mỗi replica cần:

```text
replicaId
assetId
providerId
accountId
state
remoteFileId (nếu remote)
webViewLink (nếu có)
verifiedAt
```

Health:

```text
protected
under_replicated
degraded
lost
unknown
```

Production cần persistent `MediaCloudRepository`, ví dụ SQLite:

```text
media_cloud_assets
media_cloud_replicas
```

Luồng upload:

```text
receive media
→ hash + metadata
→ catalog.registerAsset
→ local replica VERIFIED
→ policy chọn destinations
→ job upload
→ provider.upload
→ catalog UPLOADED
→ integrity.verify
→ catalog VERIFIED
```

Upload API trả success **chưa đủ** để tính backup an toàn; phải verify.

---

# 6. Media API — contract mới cho Mobile/Desktop

Package:

```text
@photox/media-api
```

Mục tiêu: Mobile/Desktop UI không đọc raw DB row, local path hoặc provider record. API trả một DTO ổn định đã aggregate từ Media Index + Cloud Catalog + Edit + Sync.

## 6.1 Endpoint đề xuất

```text
POST /api/v1/auth/pair/exchange
POST /api/v1/auth/refresh
POST /api/v1/auth/revoke

GET  /api/v1/media
GET  /api/v1/media/:id
GET  /api/v1/media/:id/thumbnail
GET  /api/v1/media/:id/preview
GET  /api/v1/media/:id/content
GET  /api/v1/media/:id/replicas
```

Có thể giữ route legacy `/api/v1/library` trong migration và map dần sang service mới.

## 6.2 MediaDTO

Response public nên giống:

```ts
{
  id: 'asset_123',
  type: 'photo',
  filename: 'IMG_001.HEIC',
  mimeType: 'image/heic',
  width: 4032,
  height: 3024,
  sizeBytes: 8123456,
  createdAt: '...',
  favorite: false,

  thumbnail: { url: '/api/v1/media/asset_123/thumbnail' },
  preview: { url: '/api/v1/media/asset_123/preview' },
  original: { url: '/api/v1/media/asset_123/content' },

  cloud: {
    health: 'protected',
    requiredReplicas: 2,
    verifiedReplicas: 3,
    locations: [
      { providerId: 'local', accountId: 'local-primary', status: 'VERIFIED' },
      { providerId: 'google-drive', accountId: 'drive-a', status: 'VERIFIED' },
      { providerId: 'telegram-bot', accountId: 'telegram-1', status: 'VERIFIED' }
    ]
  },

  edit: {
    edited: true,
    editedAssetId: 'asset_edit_456',
    recipeVersion: 1
  },

  sync: { state: 'synced', lastSyncedAt: '...' }
}
```

Không trả qua API:

```text
Google access/refresh token
Telegram bot token
local absolute filesystem path
DB internal secret fields
provider credential
recovery key
```

## 6.3 MediaViewService

`MediaViewService` aggregate:

```text
MediaRepository
      +
MediaCloudCatalog
      +
EditInfoProvider
      +
SyncInfoProvider
      ↓
MediaDTO
```

UI chỉ dùng DTO, không gọi trực tiếp 4–5 repositories.

## 6.4 Cursor pagination

Dùng:

```text
GET /api/v1/media?cursor=...&limit=100
```

Response:

```ts
{
  items: [...],
  nextCursor: '...',
  hasMore: true
}
```

Không nên dùng offset/page cho library rất lớn.

Repository thật nên biến cursor thành stable sort key, ví dụ:

```text
createdAt DESC + assetId DESC
```

Cursor public nên opaque; không để UI phụ thuộc schema DB.

## 6.5 Query/filter

Hỗ trợ:

```text
type=photo|video
from=
to=
favorite=true
albumId=
health=under_replicated|degraded
providerId=google-drive
edited=true
search=
```

Ví dụ:

```text
GET /api/v1/media?type=video&health=under_replicated
```

## 6.6 Thumbnail / Preview / Original

Không nhét binary hoặc base64 vào JSON media list.

```text
/media/:id/thumbnail   → nhỏ, cache mạnh
/media/:id/preview     → medium-res
/media/:id/content     → original/edited stream
```

`MediaContentResolver` chịu trách nhiệm tìm file thật; controller không biết file nằm Local/Drive/Telegram.

## 6.7 Video HTTP Range

Video phải forward header:

```http
Range: bytes=1048576-2097151
```

Resolver/provider trả tương ứng:

```text
206 Partial Content
Accept-Ranges: bytes
Content-Range: ...
```

Không tải toàn video rồi mới play.

Sau này `@photox/media-delivery` nên chịu trách nhiệm chọn replica tốt nhất dựa trên Local/LAN/range support/latency/health.

---

# 7. Có cần JWT/JWS không?

**Có cho tunnel/internet/multi-device; nhưng không bắt buộc core phải phụ thuộc JWT.**

`@photox/media-api` đã có abstraction:

```text
AccessTokenIssuer
AccessTokenVerifier
RefreshSessionStore
AuthorizationService
AuthSessionService
```

Production Desktop nên implement issuer/verifier bằng JOSE/JWT library uy tín. Core không hard-code library crypto cụ thể.

## 7.1 Luồng khuyến nghị

Pair QR/pair code chỉ dùng để bootstrap:

```text
Mobile scan QR
→ pairCode + deviceId
→ POST /auth/pair/exchange
→ Desktop verify pairing
→ accessToken ngắn hạn
→ refreshToken/session credential dài hơn
```

Sau đó request:

```http
Authorization: Bearer <access-token>
```

Access token nên ngắn hạn, ví dụ ~15 phút. Refresh session có thể 30 ngày nhưng phải revoke/rotate được.

## 7.2 Claims JWT/JWS đề xuất

```text
iss   = photox-desktop
aud   = photox-mobile
sub   = user/device principal
sid   = session id
did   = paired device id
scope = media:read media:download cloud:read
iat   = issued at
exp   = expiry
jti   = unique token id
```

Không đặt credential provider vào JWT payload.

## 7.3 Scope

Đã có scope contract:

```text
media:read
media:download
media:write
media:delete
cloud:read
cloud:manage
```

Ví dụ thumbnail/detail cần `media:read`; tải original cần `media:download`; repair/reconcile sau này cần `cloud:manage`.

## 7.4 Local LAN có cần JWT không?

Nếu chỉ một Desktop + Mobile trong LAN, random opaque session token cũng đủ nếu entropy tốt, có expiry và revoke.

Tuy nhiên PhotoX đã có mục tiêu tunnel/internet và nhiều device nên nên chuẩn hoá **Bearer access token** ngay từ API contract. JWT/JWS là implementation phù hợp vì stateless verify và có scope/expiry rõ ràng.

Refresh token không nên là JWT bắt buộc; tốt hơn có thể là opaque random secret được hash trong `RefreshSessionStore` để revoke/rotate dễ.

---

# 8. Integrity Verification

Package `@photox/integrity` hỗ trợ:

```text
UNKNOWN
HEALTHY
MISSING
CORRUPTED
UNREADABLE
STALE
```

Verify:

```text
exists
readable
size
SHA256
checkedAt
```

Restore Verification mạnh hơn:

```text
download replica temp
→ SHA256
→ compare original
→ delete temp
```

Replica không healthy không được tính đủ protection target.

---

# 9. Durable Jobs

Package `@photox/jobs` dùng cho:

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

State:

```text
QUEUED
RUNNING
PAUSED
RETRY_WAIT
COMPLETED
FAILED
CANCELLED
```

Production thay memory repository bằng SQLite repository. Restart Desktop phải tiếp tục được jobs chưa hoàn tất.

---

# 10. Reconciliation

Package `@photox/reconciliation` đối chiếu:

```text
Media Cloud Catalog
        ↕
Provider Inventory
```

Issue:

```text
MISSING_REMOTE
UNKNOWN_REMOTE
STATE_DRIFT
```

Ví dụ user xoá file trực tiếp trên Drive:

```text
reconcile
→ MISSING_REMOTE
→ enqueue replica.repair
→ policy/scoring chọn destination mới
→ upload
→ verify
→ protected lại
```

---

# 11. Catalog Backup / Disaster Recovery

Package `@photox/catalog-backup` backup chính catalog PhotoX.

```text
Catalog local DB
├── Google Drive backup
└── provider độc lập thứ hai
```

Snapshot có checksum và có thể encrypt.

Recovery:

```text
máy mới
→ lấy snapshot mới nhất
→ verify checksum
→ decrypt
→ import catalog
→ restore provider configs/credentials riêng
→ reconciliation
→ rebuild local index/cache
```

Recovery key không lưu cùng snapshot.

---

# 12. Advanced Replica Policy

Package `@photox/replica-policy` resolve rule theo:

```text
media type
size
album
favorite
important
edited
```

Provider scoring dùng:

```text
health
free bytes
max object size
latency
failure rate
provider/account diversity
allow/deny rules
```

Ví dụ important media:

```text
3 replicas
>= 3 accounts
>= 2 providers
backup original
backup editRecipe
optional rendered copy
```

---

# 13. Luồng hoàn chỉnh

```text
Mobile
→ access token
→ Media API upload/sync endpoint
→ Desktop receive
→ hash/metadata
→ Media Cloud Catalog
→ Advanced Policy
→ Provider Scoring
→ Durable Job
→ Provider upload
→ Integrity verify
→ VERIFIED
→ Protection health
```

Sau này:

```text
Reconciliation
→ missing/corrupt replica
→ repair job
→ new destination
→ upload + verify
→ protected
```

---

# 14. Database/repository production đề xuất

```text
media_assets
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
auth_sessions
```

`auth_sessions` lưu refresh-session metadata/hash, không lưu raw refresh token nếu tránh được.

Mọi schema cần migration/version.

---

# 15. Desktop UI sau này

Cloud Overview:

```text
Protection Score 98%
50,243 media
49,981 Protected
201 Need Backup
41 Degraded
4 Lost/Corrupted
```

Media Detail:

```text
IMG_001.HEIC
Protected • 3 copies
├── Local / Mac SSD
├── Google Drive / Account A
└── Telegram / Backup Bot 1
```

Settings:

```text
Storage Providers
Auth / Paired Devices
Active Sessions
Revoke Device
Background Jobs
Integrity / Repair
```

UI gọi service/controller; không gọi provider trực tiếp.

---

# 16. Mobile integration

Mobile không cần biết original nằm Drive hay Telegram.

Mobile chỉ dùng Media API:

```text
list media
media detail
thumbnail
preview
content stream
cloud health summary
```

PairingStore sau này nên persist:

```text
desktopBaseUrl
deviceId
refresh/session credential
access token + expiry (cache)
```

Access token hết hạn → refresh → retry request một lần.

Không yêu cầu scan QR lại trừ khi session bị revoke/mất credential.

---

# 17. Photo Editor

`@photox/image-editor` vẫn dùng non-destructive `EditRecipe`.

Media API chỉ expose trạng thái edit cần cho UI; recipe đầy đủ nên có endpoint/service riêng khi thực sự cần edit/resume.

Original asset immutable.

---

# 18. Background schedule khuyến nghị

```text
Realtime
- upload
- verify
- critical repair

Mỗi vài giờ
- provider/account health
- lightweight integrity sample

Nightly
- reconciliation incremental
- catalog backup
- protection recalculation

Weekly
- deeper reconciliation
- random restore verification
- rebalance recommendation
```

Tất cả task dài enqueue vào durable jobs, không chạy trên UI thread.

---

# 19. Thứ tự tích hợp vào main

## Phase 1 — Library only

- build/typecheck all SDK packages
- chưa đổi UI
- persistent repositories

## Phase 2 — Media API read path

1. implement `MediaRepository` từ index hiện tại
2. implement Media URL factory
3. wire `MediaCloudCatalog`
4. expose `GET /api/v1/media`
5. expose detail/thumbnail/preview/content
6. giữ `/api/v1/library` compatibility trong transition

## Phase 3 — Auth

1. implement secure pairing verifier
2. implement JWT/JWS issuer + verifier hoặc opaque access-token adapter
3. implement persistent `RefreshSessionStore`
4. exchange pair code → access + refresh
5. Mobile Bearer middleware
6. session revoke UI

## Phase 4 — Media delivery

1. local resolver
2. Drive fallback
3. Telegram fallback
4. HTTP Range video
5. cache headers
6. sau này tách `@photox/media-delivery`

## Phase 5 — Catalog + Jobs + Integrity

1. persistent catalog
2. durable queue
3. provider upload jobs
4. integrity probes
5. repair jobs

## Phase 6 — Reconciliation + Recovery

1. inventories
2. incremental reconcile
3. catalog backup
4. restore dry-run
5. full disaster recovery test

---

# 20. CI

CI phải build/typecheck:

```bash
npm --workspace @photox/media-cloud run build
npm --workspace @photox/media-api run build
npm --workspace @photox/integrity run build
npm --workspace @photox/jobs run build
npm --workspace @photox/reconciliation run build
npm --workspace @photox/catalog-backup run build
npm --workspace @photox/replica-policy run build
```

và tương ứng `run typecheck` trước platform build.

---

# 21. Checklist API/Auth trước khi gắn main

- [ ] MediaDTO không leak local path/token/secret
- [ ] cursor ổn định khi library lớn
- [ ] list endpoint không trả binary/base64
- [ ] thumbnail/preview cache được
- [ ] video Range trả 206 đúng
- [ ] resolver fallback replica khỏe khác
- [ ] access token có expiry
- [ ] scope enforcement hoạt động
- [ ] refresh session revoke được
- [ ] pair code không trở thành credential vĩnh viễn
- [ ] token không xuất hiện trong URL/query/log
- [ ] tunnel/internet chỉ dùng HTTPS/WSS
- [ ] brute-force pairing có rate limit ở HTTP layer
- [ ] provider credentials không bao giờ nằm trong JWT

---

# 22. Checklist hệ cloud

- [ ] catalog biết toàn bộ replicas
- [ ] verified replica đủ policy mới `protected`
- [ ] checksum mismatch thành corrupted
- [ ] missing remote được reconcile
- [ ] repair dùng durable job
- [ ] account full/auth error bị loại khỏi scoring
- [ ] restart app không mất pending jobs
- [ ] catalog có >= 2 backup targets
- [ ] encrypted snapshot restore được
- [ ] disaster recovery đã được test trên DB/máy mới

---

# 23. Nguyên tắc kiến trúc lâu dài

```text
UI chỉ hiển thị/phát command.
Media API là public contract; không expose raw persistence/provider model.
Pairing chỉ bootstrap session, không làm credential vĩnh viễn.
Access token ngắn hạn; refresh session phải revoke được.
Durable jobs thực thi tác vụ dài.
Media Cloud Catalog là source of truth về vị trí media.
Provider chỉ thực hiện storage operation.
Upload success chưa phải backup success; phải verify.
Replica không healthy không được tính protection target.
Reconciliation phát hiện drift giữa catalog và provider.
Catalog cũng phải backup và restore thử.
Original immutable; EditRecipe non-destructive.
Credential tách khỏi config/catalog/API.
Provider mới không được yêu cầu rewrite media API/cloud core.
Một provider lỗi không được kéo sập toàn hệ thống.
```

Giữ các nguyên tắc này để PhotoX phát triển thành personal media cloud có API ổn định, session bảo mật, streaming tốt, tự kiểm tra replica và khôi phục được sau sự cố.
