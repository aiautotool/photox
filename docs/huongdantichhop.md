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
├── video-media
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
video-media     metadata/duration/thumb/preview/playback contract cho video
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
   ├── media list/detail
   ├── thumbnail/preview/content
   └── auth/session
   ↓
Desktop services
   ├── @photox/video-media
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

**Provider không phải source of truth. `@photox/media-cloud` là nguồn sự thật về vị trí replica. `@photox/media-api` là public contract cho UI/client. `@photox/video-media` chuẩn hoá mọi thông tin và variant cần thiết để video hiển thị thời lượng, thumbnail và play được.**

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
npm --workspace @photox/video-media run build
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
Media API / Video Media / Catalog / Jobs / Policy / Providers
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

# 6. Media API — contract Mobile/Desktop

Package:

```text
@photox/media-api
```

Mục tiêu: UI không đọc raw DB row, local path hoặc provider record. API trả DTO ổn định đã aggregate từ Media Index + Video Media + Cloud Catalog + Edit + Sync.

## 6.1 Endpoint

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

Response public ví dụ:

```ts
{
  id: 'asset_123',
  type: 'video',
  filename: 'IMG_001.MOV',
  mimeType: 'video/quicktime',
  width: 3840,
  height: 2160,
  durationMs: 183240,
  sizeBytes: 812345678,
  createdAt: '...',

  thumbnail: { url: '/api/v1/media/asset_123/thumbnail' },
  preview: { url: '/api/v1/media/asset_123/preview' },
  original: { url: '/api/v1/media/asset_123/content' },

  video: {
    fps: 60,
    bitrate: 42000000,
    codec: 'hevc',
    hasAudio: true,
    playback: {
      url: '/api/v1/media/asset_123/content',
      supportsRange: true
    }
  },

  cloud: {
    health: 'protected',
    requiredReplicas: 2,
    verifiedReplicas: 3
  }
}
```

Không trả:

```text
Google access/refresh token
Telegram bot token
local absolute filesystem path
DB internal secret fields
provider credential
recovery key
```

## 6.3 Cursor pagination

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

Repository thật nên dùng stable sort key như `createdAt DESC + assetId DESC`.

## 6.4 Query/filter

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

## 6.5 Binary delivery

Không nhét binary/base64 vào JSON list.

```text
/media/:id/thumbnail
/media/:id/preview
/media/:id/content
```

`MediaContentResolver` chịu trách nhiệm tìm file thật; controller không biết file nằm Local/Drive/Telegram.

---

# 7. Video Media Library — xử lý video không play / không thumb / không duration

Package:

```text
@photox/video-media
```

Đây là library trung lập platform. Không import trực tiếp Expo, Electron, ffmpeg, AVFoundation hoặc player cụ thể.

Mục tiêu giải quyết 3 lỗi hiện tại:

```text
1. Video không có duration/time
2. Video không có thumbnail/poster
3. Video không play hoặc seek được trên Mobile/Desktop
```

## 7.1 Thành phần

```text
@photox/video-media
├── VideoProbeAdapter
├── VideoThumbnailAdapter
├── VideoPreviewAdapter
├── VideoTranscodeAdapter
├── VideoMediaRepository
├── VideoMediaService
├── VideoPlaybackResolver
└── PlaybackPolicy
```

## 7.2 Metadata chuẩn

`VideoProbeAdapter` phải trả:

```ts
{
  durationMs: 183240,
  width: 3840,
  height: 2160,
  rotation: 0,
  fps: 60,
  bitrate: 42000000,
  container: 'mov',
  videoCodec: 'hevc',
  audioCodec: 'aac',
  hasAudio: true,
  sizeBytes: 812345678
}
```

**Duration phải persist vào DB/index**. UI không được mở player chỉ để tính duration mỗi lần render list.

Khuyến nghị bảng:

```text
video_media
```

Tối thiểu:

```text
asset_id
duration_ms
width
height
rotation
fps
bitrate
container
video_codec
audio_codec
has_audio
thumbnail_uri
preview_uri
updated_at
```

## 7.3 Pipeline khi Desktop nhận/import video

```text
video received
    ↓
VideoProbeAdapter.probe
    ↓
metadata + duration
    ↓
VideoThumbnailAdapter.createThumbnail
    ↓
poster/thumbnail
    ↓
optional preview/transcode
    ↓
VideoMediaRepository.save
    ↓
Media API trả duration + thumbnail + playback info
```

Code wiring sau này:

```ts
const record = await videoMedia.process(assetId, {
  uri: localUri,
  assetId,
  mimeType,
  sizeBytes,
}, {
  thumbnailMaxWidth: 640,
  createPreview: true,
});
```

## 7.4 Thumbnail generation

Library tự chọn timestamp an toàn mặc định:

```text
min(1 giây, khoảng 10% duration)
```

và clamp trong thời lượng video để tránh seek ra ngoài EOF.

Không nên luôn lấy frame `0ms` vì nhiều video frame đầu đen/fade-in.

Thumbnail đề xuất:

```text
Grid thumbnail: 320–512 px
Detail poster: 640–1280 px
Format: JPEG/WebP theo adapter
```

Thumbnail là cache/derived media, không phải replica backup bắt buộc.

Có thể regenerate nếu mất.

## 7.5 Desktop adapter

Desktop nên implement:

```text
VideoProbeAdapter      → ffprobe/native media engine
VideoThumbnailAdapter  → ffmpeg/native media engine
VideoPreviewAdapter    → ffmpeg/native engine
VideoTranscodeAdapter  → ffmpeg/native engine khi cần
```

Library core không bundle ffmpeg để tránh ép Mobile/Desktop dùng cùng binary/runtime.

Desktop adapter chịu trách nhiệm:

```text
probe duration/codecs
extract frame
fix rotation metadata
create preview
optional compatible derivative
```

## 7.6 Mobile adapter

Mobile inject adapter dùng media APIs/native modules phù hợp platform.

Không đưa Expo/React Native dependency vào `@photox/video-media`.

Mobile chỉ cần nhận DTO:

```text
durationMs
thumbnail.url
playback.url
playback.supportsRange
mimeType
```

Player UI sau này dùng những field này.

## 7.7 Playback Resolver

Không cho player tự biết video nằm ở đâu.

Luồng:

```text
Player requests assetId
  ↓
VideoPlaybackResolver
  ↓
Media Cloud replicas
  ↓
PlaybackPolicy
  ↓
best source
  ↓
Media API content endpoint
```

`PlaybackPolicy` hiện ưu tiên:

```text
local source                    + cao nhất
HTTP Range support              + cao
video/mp4 compatible source     + cao
latency thấp                    + điểm
healthy source                  bắt buộc
```

Ví dụ:

```text
Local Mac SSD       → chọn trước
Drive A Range       → fallback
Telegram            → fallback nếu adapter/source phù hợp
```

## 7.8 HTTP Range — bắt buộc cho video lớn

Mobile/Desktop player phải gửi:

```http
Range: bytes=0-
```

hoặc range seek cụ thể.

Desktop Media API phải forward range xuống source/provider và trả:

```http
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-1048575/812345678
Content-Length: 1048576
Content-Type: video/mp4
```

Không tải toàn bộ video 2–4 GB rồi mới play.

Nếu source không hỗ trợ range, resolver có thể ưu tiên một replica khác hoặc materialize/cache local trước khi play.

## 7.9 Codec compatibility

Không phải video upload thành công là player nào cũng decode được.

`VideoMediaService.isWidelyPlayable()` hiện đánh giá baseline phổ biến:

```text
H.264 / HEVC video
AAC audio hoặc no audio
```

Nếu source không tương thích và có `VideoTranscodeAdapter`, có thể tạo derivative:

```text
Original MKV/VP9/etc.
      ↓
compatible preview/cache
MP4 + H.264 + AAC
```

**Không overwrite original.**

Derivative chỉ là variant/cache để playback.

## 7.10 Variant model

Một video có thể có:

```text
ORIGINAL
THUMBNAIL
POSTER
PREVIEW
PLAYBACK_DERIVATIVE
```

Original vẫn immutable và được backup theo policy.

Thumbnail/preview/playback derivative có thể regenerate nên không nhất thiết phải đạt replica target giống original.

## 7.11 Jobs

Video processing nên chạy qua `@photox/jobs`:

```text
video.probe
video.thumbnail.generate
video.preview.generate
video.transcode.playback
```

Khi video mới sync sang Desktop:

```text
receive video
→ enqueue video.probe
→ save duration/codec
→ enqueue thumbnail
→ thumbnail ready
→ Media API DTO update
```

Không block upload/sync chỉ vì thumbnail chưa tạo xong.

## 7.12 API khi thumbnail chưa có

Media API nên trả trạng thái thay vì URL lỗi:

```ts
{
  thumbnail: null,
  processing: {
    videoMetadata: 'ready',
    thumbnail: 'pending'
  }
}
```

UI dùng placeholder và tự refresh/subscription/event khi thumbnail ready.

Không trả broken thumbnail URL.

## 7.13 Video trên cloud nhưng local đã mất

```text
Mobile requests play
→ Desktop API
→ local replica unavailable
→ PlaybackPolicy chọn verified remote replica
→ provider/content resolver
→ Range stream nếu hỗ trợ
```

Mobile không cần biết đó là Google Drive hay Telegram.

Nếu Telegram cloud không phù hợp random range/large playback, policy có thể materialize cache local trước hoặc ưu tiên Drive/local replica.

## 7.14 Caching

Desktop nên cache:

```text
thumbnail cache
preview cache
optional playback chunks/materialized derivative
```

Cache key:

```text
assetId
sourceSha256
variant
variantVersion
```

Original checksum đổi → derived cache invalid.

## 7.15 Delete

Khi xóa original:

```text
Trash original
→ mark derived variants disposable
→ purge thumbnails/previews theo lifecycle
```

Không coi thumbnail là một original asset độc lập.

## 7.16 Checklist video trước khi gắn UI

- [ ] probe trả duration chính xác
- [ ] duration persist sau restart
- [ ] width/height/rotation đúng
- [ ] codec/container được đọc
- [ ] thumbnail tạo được
- [ ] frame thumbnail không vượt duration
- [ ] thumbnail missing có placeholder
- [ ] Range request trả 206
- [ ] seek video hoạt động
- [ ] player không tải toàn file trước khi phát
- [ ] local source được ưu tiên
- [ ] remote fallback hoạt động
- [ ] incompatible source có strategy preview/transcode
- [ ] original không bị overwrite bởi transcode
- [ ] processing chạy background job
- [ ] cache có invalidation theo source hash

---

# 8. JWT/JWS / Auth

**Có cho tunnel/internet/multi-device; nhưng core không bắt buộc phụ thuộc JWT.**

`@photox/media-api` có abstraction:

```text
AccessTokenIssuer
AccessTokenVerifier
RefreshSessionStore
AuthorizationService
AuthSessionService
```

Production Desktop nên implement issuer/verifier bằng JOSE/JWT library uy tín.

## 8.1 Pairing → session

```text
Mobile scan QR
→ pairCode + deviceId
→ POST /auth/pair/exchange
→ Desktop verify pairing
→ accessToken ngắn hạn
→ refreshToken/session credential dài hơn
```

Sau đó:

```http
Authorization: Bearer <access-token>
```

Access token khoảng 15 phút là reasonable default; refresh session revoke/rotate được.

## 8.2 Claims

```text
iss   = photox-desktop
aud   = photox-mobile
sub   = principal
sid   = session id
did   = paired device id
scope = media:read media:download cloud:read
iat
exp
jti
```

Không đặt provider credential vào token payload.

## 8.3 Scope

```text
media:read
media:download
media:write
media:delete
cloud:read
cloud:manage
```

Refresh token có thể là opaque random secret + hash trong DB để revoke dễ hơn.

---

# 9. Integrity Verification

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

Restore Verification:

```text
download replica temp
→ SHA256
→ compare original
→ delete temp
```

Replica không healthy không được tính đủ protection target.

---

# 10. Durable Jobs

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
video.probe
video.thumbnail.generate
video.preview.generate
video.transcode.playback
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

# 11. Reconciliation

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

# 12. Catalog Backup / Disaster Recovery

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
→ regenerate video thumbnails/previews nếu cần
```

Recovery key không lưu cùng snapshot.

---

# 13. Advanced Replica Policy

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

# 14. Luồng hoàn chỉnh

Ảnh:

```text
Mobile
→ Media API
→ Desktop receive
→ hash/metadata
→ Catalog
→ Policy/Scoring
→ Job
→ Provider upload
→ Integrity verify
→ VERIFIED
```

Video:

```text
Mobile/Desktop imports video
→ Desktop receive/index
→ video.probe
→ duration + codec + dimensions persist
→ thumbnail job
→ Media API exposes metadata + thumb
→ PlaybackResolver chooses source
→ Range stream
```

Backup và playback là hai concern khác nhau:

```text
Original replica health → Media Cloud / Integrity
Playable variant/source → Video Media / PlaybackPolicy
```

---

# 15. Database/repository production đề xuất

```text
media_assets
video_media
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

# 16. Desktop UI sau này

Cloud Overview:

```text
Protection Score 98%
50,243 media
49,981 Protected
201 Need Backup
41 Degraded
4 Lost/Corrupted
```

Video grid item:

```text
┌──────────────────────┐
│     thumbnail        │
│                 3:03 │
└──────────────────────┘
```

Duration đọc từ persisted `durationMs`, không probe lại lúc render UI.

Video detail:

```text
poster
play/pause
seek bar
time / duration
volume
fullscreen
metadata
backup health
```

UI gọi API/service; không gọi ffmpeg/provider trực tiếp.

---

# 17. Mobile integration

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

Video card lấy:

```text
thumbnail.url
durationMs
```

Video player lấy:

```text
playback/content URL
Bearer token
Range support
mimeType
```

Nếu access token hết hạn → refresh → retry một lần.

Không yêu cầu scan QR lại trừ khi session bị revoke/mất credential.

---

# 18. Photo Editor

`@photox/image-editor` vẫn dùng non-destructive `EditRecipe`.

Original immutable.

Video editing/transcoding không được nhét vào image-editor; nếu sau này làm Video Editor thì tạo package riêng dùng chung video metadata/variant contracts từ `@photox/video-media`.

---

# 19. Background schedule khuyến nghị

```text
Realtime
- upload
- video metadata probe
- upload verification
- critical repair

Ngay sau video ingest
- thumbnail generation
- optional preview generation

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

# 20. Thứ tự tích hợp vào main

## Phase 1 — Library only

- build/typecheck all packages
- chưa đổi UI
- implement persistent repositories/adapters

## Phase 2 — Media API read path

1. implement `MediaRepository`
2. implement Media URL factory
3. wire `MediaCloudCatalog`
4. expose list/detail
5. giữ `/api/v1/library` compatibility

## Phase 3 — Video metadata + thumbnail

1. implement Desktop `VideoProbeAdapter`
2. implement Desktop `VideoThumbnailAdapter`
3. persistent `VideoMediaRepository`
4. enqueue probe khi video ingest
5. enqueue thumbnail
6. map `durationMs` + thumbnail vào MediaDTO
7. mobile/desktop grid dùng DTO mới

## Phase 4 — Video playback

1. implement `VideoPlaybackResolver`
2. local source support
3. Media API Range forwarding
4. Drive fallback
5. Telegram/cache strategy
6. compatible playback derivative khi codec không phù hợp
7. player Mobile/Desktop chỉ dùng API URL

## Phase 5 — Auth

1. secure pairing verifier
2. JWT/JWS issuer/verifier hoặc opaque token adapter
3. persistent RefreshSessionStore
4. exchange pair code → session
5. Bearer middleware
6. revoke

## Phase 6 — Catalog + Jobs + Integrity

1. persistent catalog
2. durable queue
3. provider upload jobs
4. integrity probes
5. repair jobs

## Phase 7 — Reconciliation + Recovery

1. inventories
2. incremental reconcile
3. catalog backup
4. restore dry-run
5. disaster recovery test

---

# 21. CI

CI phải build/typecheck:

```bash
npm --workspace @photox/media-cloud run build
npm --workspace @photox/media-api run build
npm --workspace @photox/video-media run build
npm --workspace @photox/integrity run build
npm --workspace @photox/jobs run build
npm --workspace @photox/reconciliation run build
npm --workspace @photox/catalog-backup run build
npm --workspace @photox/replica-policy run build
```

và tương ứng `run typecheck` trước platform build.

---

# 22. Checklist API/Auth

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

# 23. Checklist hệ cloud

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

# 24. Nguyên tắc kiến trúc lâu dài

```text
UI chỉ hiển thị/phát command.
Media API là public contract; không expose raw persistence/provider model.
Video metadata phải persist; UI không probe video để render list.
Thumbnail/preview/playback derivative là regenerated variants, không thay original.
Original video/image immutable.
Player không biết provider; resolver chọn source.
Video lớn phải hỗ trợ Range hoặc materialize/cache trước playback.
Pairing chỉ bootstrap session, không làm credential vĩnh viễn.
Access token ngắn hạn; refresh session phải revoke được.
Durable jobs thực thi tác vụ dài.
Media Cloud Catalog là source of truth về vị trí media.
Provider chỉ thực hiện storage operation.
Upload success chưa phải backup success; phải verify.
Replica không healthy không được tính protection target.
Reconciliation phát hiện drift giữa catalog và provider.
Catalog cũng phải backup và restore thử.
Credential tách khỏi config/catalog/API.
Provider mới không được yêu cầu rewrite media API/cloud core.
Một provider lỗi không được kéo sập toàn hệ thống.
```

Giữ các nguyên tắc này để PhotoX phát triển thành personal media cloud có API ổn định, video metadata/thumbnail/playback đúng, session bảo mật, streaming tốt, tự kiểm tra replica và khôi phục được sau sự cố.
