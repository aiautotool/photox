# Hướng dẫn tích hợp PhotoX SDK vào app Mobile và Desktop hiện tại

> Áp dụng cho SDK trên branch `photox-sdk-v2` và app hiện tại của `main`.
>
> **Nguyên tắc:** thư viện trước, wiring sau. Không xoá/rewrite code cũ; giữ route/logic legacy trong giai đoạn migration và chuyển từng lớp một.

---

# 1. Kiến trúc SDK hiện tại

```text
packages/
├── contracts
├── media
├── media-cloud
├── media-api
├── media-delivery
├── media-delivery-node
├── video-media
├── video-ffmpeg
├── storage
├── replica-policy
├── integrity
├── jobs
├── reconciliation
├── catalog-backup
├── persistence-sqlite
├── auth-jose
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
contracts              type/contract chung
media                  media index + metadata abstraction
media-cloud            source of truth về replica
media-api              DTO/query/content/auth public contract
media-delivery         chọn replica tốt nhất để trả content
media-delivery-node    Local file + HTTP Range/proxy runtime adapter
video-media            metadata/thumb/preview/playback contracts
video-ffmpeg           ffprobe/ffmpeg runtime adapter thật cho Desktop
storage                provider registry + replication execution
replica-policy         policy nâng cao + provider scoring
integrity              verify tồn tại/readable/size/SHA256
jobs                   durable queue/retry/checkpoint
reconciliation         phát hiện drift catalog ↔ provider
catalog-backup         backup/restore catalog
persistence-sqlite     persistent repositories dùng SQLite
Auth JOSE              JWT/JWS access-token implementation
sync                    orchestration/event
transport               HTTP transport abstraction
providers               Local / Drive / Telegram
image-editor             non-destructive editor
mobile-sdk               facade/client cho mobile
desktop-sdk              facade/composition cho desktop
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
@photox/media-delivery
   ↓
Media Cloud Catalog
   ↓
Local / Google Drive / Telegram

Desktop background services
   ├── Durable Jobs
   ├── Integrity
   ├── Reconciliation
   ├── Replica Policy
   ├── Video Pipeline
   └── Catalog Backup
```

`@photox/media-cloud` là nguồn sự thật về vị trí replica. Provider chỉ thực hiện thao tác lưu trữ.

---

# 2. Build / typecheck monorepo

Không chạy typecheck PhotoX package theo thứ tự ngẫu nhiên. Các package phụ thuộc declaration trong `dist` của package trước.

Root đã có:

```bash
npm run build:sdk
npm run typecheck:sdk
```

Hai script này build/typecheck đúng dependency order.

Trước integration phải đạt:

```text
npm install             PASS
npm run build:sdk       PASS
npm run typecheck:sdk   PASS
npm test                PASS
npm run build           PASS
```

PhotoX SDK CI cũng dùng chính hai command trên để tránh false-failure do workspace order.

---

# 3. Tạo branch tích hợp từ main

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Merge/cherry-pick `photox-sdk-v2` vào branch tích hợp. Không merge thẳng vào `main` trước khi Desktop + Mobile build/test xong.

---

# 4. SQLite persistence — dùng thật trên Desktop

Package:

```text
@photox/persistence-sqlite
```

Dùng Node built-in SQLite runtime để persist các thành phần quan trọng.

Khởi tạo:

```ts
import {
  SqlitePhotoXStore,
  SqliteJobRepository,
  SqliteMediaCloudRepository,
  SqliteVideoMediaRepository,
  SqliteRefreshSessionStore,
} from '@photox/persistence-sqlite';

const store = new SqlitePhotoXStore({
  path: `${app.getPath('userData')}/photox.db`,
});
```

Repositories:

```ts
const jobsRepo = new SqliteJobRepository(store);
const cloudRepo = new SqliteMediaCloudRepository(store);
const videoRepo = new SqliteVideoMediaRepository(store);
const refreshSessions = new SqliteRefreshSessionStore(store);
```

Persist hiện tại:

```text
photox_jobs
photox_media_cloud
photox_video_media
photox_refresh_sessions
```

Refresh token raw không lưu DB; chỉ lưu SHA-256 hash.

Không dùng Memory repositories trong production Desktop.

---

# 5. Media Cloud Catalog

```ts
const cloudCatalog = new MediaCloudCatalog(cloudRepo, {
  targetReplicas: 2,
  requireDistinctAccounts: true,
  preferDistinctProviders: true,
});
```

Khi Desktop nhận media:

```text
receive file
→ hash + metadata
→ registerAsset
→ attach local VERIFIED replica
→ enqueue remote replication jobs
```

Replica identity:

```text
replicaId
assetId
providerId
accountId
state
remoteFileId
```

Health:

```text
protected
under_replicated
degraded
lost
unknown
```

UI không tự đếm replica bằng cách query provider; đọc từ Media Cloud Catalog.

---

# 6. Durable Jobs

```ts
const jobs = new DurableJobQueue(jobsRepo);
```

Các tác vụ dài phải đưa vào jobs:

```text
media.upload
replica.verify
replica.repair
catalog.reconcile
catalog.backup
catalog.restore
video.probe
video.thumbnail.generate
video.preview.generate
video.transcode.playback
media.delete
storage.rebalance
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

Desktop restart phải đọc lại `QUEUED` / `RETRY_WAIT` và tiếp tục.

---

# 7. Video metadata / thumbnail / playback

Core:

```text
@photox/video-media
```

Runtime Desktop:

```text
@photox/video-ffmpeg
```

Khởi tạo:

```ts
import { FfmpegVideoAdapter } from '@photox/video-ffmpeg';
import { VideoMediaService } from '@photox/video-media';

const ffmpeg = new FfmpegVideoAdapter({
  ffmpegPath: '/path/to/ffmpeg',
  ffprobePath: '/path/to/ffprobe',
  outputDir: `${app.getPath('userData')}/video-cache`,
});

const video = new VideoMediaService(
  ffmpeg,
  ffmpeg,
  videoRepo,
  ffmpeg,
  ffmpeg,
);
```

Pipeline:

```text
video received
→ ffprobe metadata
→ duration / width / height / fps / bitrate / codecs
→ create thumbnail/poster
→ optional preview
→ optional H.264/AAC MP4 playback derivative
→ save metadata to SQLite
```

Original không bị overwrite.

Thumbnail mặc định lấy frame an toàn khoảng `min(1s, 10% duration)` để tránh frame đầu đen.

Video record chứa:

```text
durationMs
width
height
rotation
fps
bitrate
container
videoCodec
audioCodec
hasAudio
thumbnail
preview
```

---

# 8. Media Delivery — chọn nguồn và HTTP Range

Core:

```text
@photox/media-delivery
```

Node adapters:

```text
@photox/media-delivery-node
```

Resolver:

```ts
const delivery = new MediaDeliveryResolver(deliveryCatalog)
  .register(new LocalFileDeliveryAdapter('local'));
```

Remote provider có thể dùng `HttpDeliveryAdapter` hoặc adapter riêng để lấy authenticated URL/stream.

Ranking ưu tiên:

```text
VERIFIED/healthy
→ Local
→ supports HTTP Range
→ MP4-compatible
→ latency thấp
```

Nếu Local hỏng/mất:

```text
Media API request
→ Local fails
→ Drive candidate
→ Telegram candidate
→ trả candidate đầu tiên hoạt động
```

Không viết fallback logic trong UI/player.

## HTTP Range

Local adapter hỗ trợ:

```http
Range: bytes=1048576-2097151
```

và trả:

```http
206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes .../...
Content-Length: ...
```

Đây là điều kiện để video lớn play/seek mà không tải toàn bộ file.

---

# 9. Media API

Package:

```text
@photox/media-api
```

Endpoint đích:

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

List dùng cursor pagination:

```text
GET /api/v1/media?cursor=...&limit=100
```

Có filter:

```text
type
from/to
favorite
albumId
health
providerId
edited
search
```

Không trả binary/base64 trong list JSON.

Không expose:

```text
local absolute path
Google token
Telegram bot token
recovery key
provider credential
```

---

# 10. JWT/JWS thật bằng JOSE

Package:

```text
@photox/auth-jose
```

Khởi tạo với secret tối thiểu 32 bytes từ secure storage:

```ts
const tokenService = new JoseAccessTokenService({
  secret: jwtSecret,
  issuer: 'photox-desktop',
  audience: 'photox-mobile',
});
```

`tokenService` implement cả:

```text
AccessTokenIssuer
AccessTokenVerifier
```

Claims:

```text
iss
aud
sub
sid
did
scopes
iat
exp
jti
```

Không nhét provider credentials vào JWT.

Luồng pairing:

```text
QR / pair code
→ verify pairing
→ create refresh session SQLite
→ issue access JWT ~15m
→ mobile dùng Authorization: Bearer <token>
```

Refresh session có thể revoke theo `sessionId`.

Tunnel/internet phải dùng HTTPS/WSS.

---

# 11. Mobile SDK mới + compatibility cũ

Legacy `DesktopClient` vẫn giữ:

```text
/api/v1/status
/api/v1/library
x-photosync-pair-code
```

Không xoá cho tới khi migration hoàn tất.

Client mới:

```text
MediaApiClient
```

Hỗ trợ:

```text
Bearer access token
access expiry check
refresh access token
retry request 1 lần sau 401
list MediaDTO
media detail
replicas
content/thumbnail/preview paths
```

Production Mobile phải implement `MobileAuthSessionStore` bằng Keychain/Keystore/SecureStore tương ứng; `MemoryMobileAuthSessionStore` chỉ dành dev/test.

---

# 12. Storage Providers

## Local

Dùng `@photox/provider-local`.

## Google Drive

Giữ OAuth/Drive legacy, bọc bằng adapter cho `@photox/provider-google-drive`.

Legacy replica thiếu `providerId` normalize thành:

```text
google-drive
```

## Telegram

Dùng `@photox/provider-telegram`.

Bot token phải nằm trong secure secret store, không plaintext DB/config.

Telegram `file_id` phải luôn đi cùng `accountId` vì file ID gắn với bot context.

---

# 13. Integrity

```text
@photox/integrity
```

Sau upload:

```text
exists?
readable?
size match?
SHA256 match?
```

State:

```text
HEALTHY
MISSING
CORRUPTED
UNREADABLE
STALE
UNKNOWN
```

Upload API success chưa được tính `VERIFIED` cho tới khi verify phù hợp provider.

---

# 14. Replica Policy + scoring

```text
@photox/replica-policy
```

Policy dựa trên:

```text
media type
file size
album
favorite
important
edited
```

Scoring dựa trên:

```text
account health
free space
max object size
latency
recent failure rate
provider/account diversity
```

Important media có thể yêu cầu:

```text
3 replicas
>= 3 accounts
>= 2 providers
```

---

# 15. Reconciliation

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
→ mark replica lỗi
→ enqueue replica.repair
→ policy chọn destination mới
→ upload + verify
→ protected lại
```

---

# 16. Catalog Backup / Recovery

Catalog phải được backup tối thiểu 2 destination độc lập.

```text
local DB
├── Drive A
└── provider/account khác
```

Snapshot:

```text
schemaVersion
catalogVersion
createdAt
payload
checksum
encrypted
```

Disaster recovery:

```text
máy mới
→ lấy latest catalog snapshot
→ verify checksum
→ decrypt
→ import catalog
→ restore provider credentials riêng
→ reconciliation
→ rebuild cache/index
```

Recovery key không lưu cùng snapshot.

---

# 17. Desktop SDK composition

`PhotoXDesktopSDK` vẫn giữ storage/sync facade cũ nhưng đã expose `services` để inject dần:

```ts
const sdk = new PhotoXDesktopSDK({
  services: {
    mediaCloud: cloudCatalog,
    mediaApi,
    delivery,
    integrity,
    jobs,
    reconciliation,
    catalogBackup,
    catalogRecovery,
    replicaPolicy,
    providerScoring,
    video,
  },
});
```

Có thể thêm từng service bằng:

```ts
sdk.use('video', video);
sdk.use('jobs', jobs);
```

Mục tiêu là không rewrite `desktop/electron/main.ts` trong một lần.

---

# 18. Thứ tự wiring vào Desktop

## Phase 1 — build/runtime foundation

```text
SQLite store
JWT secret store
ffmpeg/ffprobe binary path
provider credentials
```

## Phase 2 — read path

```text
MediaRepository adapter legacy
MediaCloudCatalog
Video metadata DB
MediaDeliveryResolver
GET /api/v1/media
GET thumbnail/preview/content
```

Giữ `/api/v1/library` song song.

## Phase 3 — auth

```text
pair exchange
JOSE access token
SQLite refresh sessions
Bearer middleware
revoke session
```

## Phase 4 — video

```text
video.probe
video.thumbnail.generate
video preview/transcode
Range content route
player test + seek test
```

## Phase 5 — backup pipeline

```text
jobs
replication
integrity verify
MediaCloudCatalog update
policy/scoring
```

## Phase 6 — resilience

```text
reconciliation
repair jobs
catalog backup
restore dry-run
```

---

# 19. Thứ tự wiring Mobile

```text
1. persist pair/session credentials securely
2. MediaApiClient
3. Bearer auth
4. MediaDTO list/grid
5. thumbnail endpoint
6. video duration overlay
7. video content stream
8. player seek/range
9. download/edit/delete actions
10. remove legacy /library only sau khi stable
```

Mobile không cần biết file nằm Local/Drive/Telegram.

---

# 20. Integration tests bắt buộc

Trước khi chuyển production behavior:

```text
upload → local catalog → remote replication → verify
restart Desktop → jobs còn và resume
restart Desktop → catalog/video metadata còn
list media → cursor pagination đúng
video → duration đúng
video → thumbnail tạo được
video → play local
video → seek Range 206
local replica missing → Drive fallback
Drive fail → provider khác fallback
pair → JWT → access media
expired JWT → refresh → retry
revoke session → refresh fail
manual remote delete → reconciliation detect
repair → protected trở lại
catalog snapshot → restore DB mới
```

---

# 21. Checklist trước khi merge main

```text
[ ] npm install PASS
[ ] npm run build:sdk PASS
[ ] npm run typecheck:sdk PASS
[ ] npm test PASS
[ ] desktop build PASS
[ ] mobile typecheck/build PASS
[ ] SQLite repositories dùng thật
[ ] no Memory repository production
[ ] ffmpeg/ffprobe adapter hoạt động trên macOS + Windows
[ ] video duration/thumb/play/seek PASS
[ ] Range 206 PASS
[ ] MediaDelivery fallback PASS
[ ] JOSE JWT verify PASS
[ ] refresh revoke PASS
[ ] provider credentials không leak
[ ] catalog replica migration PASS
[ ] job resume after restart PASS
[ ] reconciliation/repair PASS
[ ] catalog backup/restore PASS
```

---

# 22. Nguyên tắc lâu dài

```text
UI chỉ hiển thị và phát command.
Media API là public contract, không expose raw DB/provider model.
Mobile không biết provider storage thật.
Media Delivery quyết định replica nào phục vụ content.
Media Cloud Catalog là source of truth về replica.
Upload success chưa phải backup success; phải verify.
Durable jobs xử lý tác vụ dài và phải sống qua restart.
Video metadata/thumbnail được xử lý background, không tính lại khi render grid.
Original media immutable.
Playback derivative chỉ là cache/variant.
Pairing chỉ bootstrap session, không phải credential vĩnh viễn.
Access JWT ngắn hạn; refresh session revoke được.
Credential không nằm trong API response/JWT/log.
Provider mới không được yêu cầu rewrite cloud/media-api core.
Một provider lỗi không được kéo sập toàn bộ pipeline.
```

Giữ kiến trúc này để PhotoX có thể tiến từ app sync ảnh/video thành personal media cloud có backup redundancy, streaming video đúng chuẩn, tự kiểm tra lỗi và phục hồi được sau sự cố.
