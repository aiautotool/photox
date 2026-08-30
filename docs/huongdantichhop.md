# Hướng dẫn tích hợp PhotoX SDK vào app Mobile và Desktop hiện tại

> Tài liệu này mô tả cách tích hợp các thư viện mới trên branch `photox-sdk-v2` vào code ứng dụng hiện tại của `main`.
>
> **Nguyên tắc:** không xoá hoặc rewrite toàn bộ code cũ. Tích hợp theo từng lớp, dùng adapter để bọc logic hiện có, kiểm thử từng chức năng rồi mới chuyển UI sang SDK.

## 1. Mục tiêu

Các package mới được thiết kế để app Mobile và Desktop dùng chung contract/business logic:

```text
packages/
├── contracts              # Contract chung
├── storage                # Storage registry/policy/replication
├── sync                   # Sync engine + queue + event bus
├── media                  # Media services/index
├── transport              # Transport abstraction
├── update-core            # Update manifest/checking
├── provider-local         # Local storage provider
├── provider-google-drive  # Google Drive provider adapter
├── desktop-sdk            # Facade cho Desktop
├── mobile-sdk             # Facade cho Mobile
└── image-editor           # Photo Editor SDK non-destructive
```

Mục tiêu tích hợp cuối cùng:

```text
Mobile UI
   ↓
@photox/mobile-sdk
   ↓
contracts / media / transport / image-editor
   ↓ HTTP / Tunnel
Desktop API
   ↓
@photox/desktop-sdk
   ↓
storage / sync / providers
   ↓
Local / Google Drive / provider tương lai
```

---

# PHẦN A — CHUẨN BỊ TÍCH HỢP

## 2. Merge/copy SDK vào nhánh tích hợp

Không merge thẳng vào `main` khi chưa test.

Khuyến nghị tạo branch:

```bash
git checkout main
git pull
git checkout -b integrate-photox-sdk
```

Sau đó merge/cherry-pick code SDK từ `photox-sdk-v2` vào branch này.

Chỉ sau khi Mobile + Desktop build/test thành công mới tạo PR về `main`.

## 3. Workspace

Root repo đã dùng:

```json
"workspaces": ["mobile", "desktop", "relay", "packages/*"]
```

Vì vậy các package trong `packages/*` tự động trở thành npm workspace.

Chạy:

```bash
npm install
```

Sau đó build SDK trước app:

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
npm --workspace @photox/desktop-sdk run build
npm --workspace @photox/mobile-sdk run build
```

---

# PHẦN B — TÍCH HỢP DESKTOP

## 4. Không xoá `desktop/electron/main.ts`

`main.ts` hiện đang chứa nhiều logic legacy: Mobile API, local media index, Google OAuth/Drive, quota, upload/download, replica và Electron IPC.

Không rewrite file này ngay.

Tích hợp theo adapter:

```text
Legacy main.ts
    ↓ callback/adapter
PhotoX Desktop SDK
    ↓
StorageProvider contract
```

## 5. Khởi tạo Desktop SDK

Tạo ví dụ:

```text
desktop/electron/services/photoxSdk.ts
```

```ts
import { PhotoXDesktopSDK } from '@photox/desktop-sdk';

export const photoX = new PhotoXDesktopSDK();
```

Sau đó đăng ký provider.

## 6. Tích hợp Local Storage

```ts
import { LocalStorageProvider } from '@photox/provider-local';

photoX.registerStorageProvider(
  new LocalStorageProvider('/path/to/photox/storage')
);
```

Đường dẫn thực tế nên lấy từ Electron `app.getPath('userData')` hoặc cấu hình Storage Location hiện có.

Không hard-code đường dẫn production.

## 7. Tích hợp Google Drive hiện tại

Không bỏ code OAuth/Google Drive cũ.

Dùng code hiện tại làm implementation cho adapter của `GoogleDriveProvider`.

Luồng:

```text
GoogleDriveProvider
       ↓
GoogleDriveAdapter
       ↓
OAuth/access token hiện tại
       ↓
@photosync/google-drive
```

Adapter cần map các chức năng hiện có:

- list account
- quota
- upload
- download
- webViewLink
- health check
- remove account nếu hỗ trợ

Mỗi replica phải có identity chuẩn:

```ts
{
  providerId: 'google-drive',
  accountId: '...',
  remoteFileId: '...'
}
```

Replica legacy không có `providerId` được migrate logic thành:

```ts
providerId = 'google-drive'
```

Không cần rewrite database ngay; có thể normalize khi đọc record cũ.

## 8. Chuyển replica policy sang Storage Engine

Thay vì để UI hoặc `main.ts` tự quyết định tài khoản Drive, dần chuyển sang:

```text
StorageProviderRegistry
        ↓
StoragePolicyEngine
        ↓
ReplicationService
```

Policy khuyến nghị:

```ts
{
  targetReplicas: 2,
  distinctAccounts: true,
  preferDistinctProviders: true,
  reserveBytes: 100 * 1024 * 1024
}
```

Mục tiêu:

```text
Asset
 ↓
Local copy
 ↓
Replica 1 → Google Drive account A
 ↓
Replica 2 → Google Drive account B
```

Khi có OneDrive/S3/NAS sau này:

```text
Replica 1 → Google Drive
Replica 2 → OneDrive
```

mà business logic không phải sửa.

## 9. Mobile API Desktop

Giữ API legacy hoạt động trong giai đoạn migration:

```text
GET  /api/v1/status
GET  /api/v1/library
POST /api/v1/media
GET  /api/v1/media/:key
```

Sau đó chuyển implementation phía sau API sang SDK từng route một.

Không đổi protocol Mobile + Desktop cùng lúc.

Thứ tự nên là:

1. `/status`
2. `/library`
3. download media
4. upload media
5. storage providers
6. delete
7. edit recipe sync

---

# PHẦN C — TÍCH HỢP MOBILE

## 10. Khởi tạo Mobile SDK

Tạo:

```text
mobile/src/services/photoxSdk.ts
```

Khởi tạo `PhotoXMobileSDK` với adapter storage/network tương ứng.

Pairing credential nên lưu bằng Expo SecureStore thông qua `KeyValueStore`, không cho SDK import trực tiếp Expo.

Ví dụ adapter:

```ts
import * as SecureStore from 'expo-secure-store';

export const secureStoreAdapter = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
```

## 11. Pairing

UI QR hiện tại sau khi scan chỉ cần chuyển kết quả pairing vào:

```ts
await sdk.pair({
  baseUrl,
  pairCode,
  deviceId,
  pairedAt: new Date().toISOString(),
});
```

Khi app khởi động:

```ts
await sdk.restorePairing();
```

Không yêu cầu user scan QR lại nếu credential vẫn hợp lệ.

---

# PHẦN D — NÚT DOWNLOAD / DELETE / EDIT TRÊN MOBILE

## 12. Download ảnh/video

UI không tự xử lý permission/download nữa.

Button handler chỉ gọi:

```ts
await sdk.media.download(asset);
```

`MediaActions` chịu trách nhiệm orchestration.

Expo-specific behavior nằm trong `ExpoMediaLibraryAdapter`.

UI chỉ xử lý trạng thái:

```text
idle
loading
success
error
```

và toast/snackbar tương ứng.

## 13. Delete

Khi user chọn Delete:

```ts
await sdk.media.delete(asset, {
  libraryAssetIds: [localAssetId],
  deleteRemote: true,
});
```

Không nên hard delete cloud ngay trong UI.

Khuyến nghị sau này thêm Trash policy:

```text
User Delete
   ↓
Move to PhotoX Trash
   ↓
30 ngày
   ↓
Permanent Delete
```

Remote delete phải đi qua Desktop/storage provider để đảm bảo các replica được quản lý đồng nhất.

---

# PHẦN E — PHOTO EDITOR MOBILE

## 14. Kiến trúc Editor

UI Mobile không phụ thuộc renderer cụ thể.

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
       ↓
IMG.LY / Native / GPU renderer
```

## 15. Khởi tạo Editor

```ts
import { PhotoEditorSDK } from '@photox/image-editor';

const editor = new PhotoEditorSDK({
  renderer,
  sceneAnalyzer,
});
```

Khi mở ảnh:

```ts
const session = editor.createSession({
  uri: asset.uri,
  width: asset.width,
  height: asset.height,
});
```

Session phải tồn tại trong suốt vòng đời màn Edit.

## 16. Layout Mobile Editor

UI khuyến nghị:

```text
┌───────────────────────────────────┐
│ ×        Edit       Compare Save  │
├───────────────────────────────────┤
│                                   │
│             CANVAS                │
│                                   │
│       Hold to see original        │
│                                   │
├───────────────────────────────────┤
│ ↶   ↷     Edited • 8 adjustments │
├───────────────────────────────────┤
│ dynamic editor panel              │
├───────────────────────────────────┤
│Preset Adjust Crop Retouch Filter… │
└───────────────────────────────────┘
```

Canvas cần hỗ trợ:

- pinch zoom
- double tap zoom
- pan khi zoom
- hold Before / release After
- Compare
- crop interaction mode

Gesture thuộc UI/render adapter, không đưa vào business recipe.

## 17. Preset

Toolbar đặt `Presets` đầu tiên.

```ts
const presets = editor.presets.list();
```

Khi chọn preset:

```ts
editor.presets.apply(session, presetId, intensity);
```

Preset phải tạo các adjustment operation trong recipe, không bake trực tiếp pixel.

Sau khi apply preset, user vẫn chỉnh từng thông số trong Adjust.

## 18. Smart Preset

Khi mở Editor:

```ts
const recommendations = await editor.smartPresets?.recommend(source, 3);
```

Scene analyzer có thể trả:

```text
portrait
sky
food
night
indoor
document
landscape
```

Không để `SmartPresetEngine` phụ thuộc CoreML/TFLite cụ thể.

Mobile tạo adapter:

```text
CoreML/TFLite
      ↓
SceneAnalyzer
      ↓
SmartPresetEngine
```

## 19. Adjust

UI chia tab:

```text
Light | Color | Detail | Effects | Geometry
```

Khi slider thay đổi, tạo/update operation qua `AdjustmentEngine`.

Không render full-resolution cho mỗi pixel slider movement.

Khuyến nghị:

```text
Slider move
 ↓
low-resolution preview
 ↓ debounce/cancel stale render
User release slider
 ↓
high-quality preview
Save
 ↓
full-resolution render
```

## 20. HSL / Color Mixer

UI:

```text
Red Orange Yellow Green Aqua Blue Purple Magenta
```

Mỗi channel:

```text
Hue
Saturation
Luminance
```

Giá trị được lưu trong recipe để desktop có thể render cùng kết quả.

## 21. Tone Curve

Channels:

```text
RGB
Red
Green
Blue
```

UI chỉ chỉnh control points; `AdjustmentEngine` chịu trách nhiệm recipe representation.

## 22. Crop & Geometry

Ratio:

```text
Free
Original
1:1
4:3
3:4
16:9
9:16
```

Các action:

```text
Rotate
Flip Horizontal
Flip Vertical
Straighten
Perspective Vertical
Perspective Horizontal
```

Grid là UI-only state:

```text
Rule of thirds
Golden ratio
Center
```

Không cần persist grid vào edit recipe.

## 23. Retouch

UI map vào `RetouchEngine`:

```text
Heal
Remove Object
Face
```

Face controls:

```text
Skin Smooth
Skin Tone
Face Brightness
Teeth Whitening
Eye Brightness
Eye Detail
```

Các operation AI phải lưu mask/parameter/reference cần thiết trong recipe hoặc persistent edit assets để có thể re-edit.

Không bake thẳng vào original.

## 24. Filters và LUT

Filter khác Preset:

```text
Preset = tập adjustment
Filter = LUT/color transformation
```

UI filter sau này map vào filter operation.

Để hỗ trợ `.cube LUT`, nên lưu:

```ts
{
  lutId,
  version,
  intensity
}
```

Không nên nhúng toàn bộ LUT binary vào recipe.

LUT file được quản lý riêng trong asset/cache repository.

## 25. Undo / Redo / History

Button:

```ts
session.undo();
session.redo();
```

History screen lấy timeline từ `HistoryEngine`.

User chọn một history step thì tạo recipe tại state tương ứng, không sửa ảnh gốc.

## 26. Thoát Editor

Nếu session dirty:

```text
Discard changes
Save draft
Cancel
```

`Save draft` chỉ persist recipe, không bắt buộc render ảnh full resolution.

Đây là cách giúp thoát Editor nhanh.

---

# PHẦN F — SAVE / EXPORT

## 27. Save Copy

Luồng:

```text
EditRecipe
 ↓
ExportEngine
 ↓
RendererAdapter
 ↓
new local file
 ↓
Media Library
 ↓
PhotoX DB
```

Không overwrite original.

## 28. Replace Edited Version

`Replace Edited Version` trong PhotoX nên hiểu là thay **current rendered edited version**, không xoá original.

Database vẫn giữ:

```text
originalAssetId
editedAssetId
editRecipe
```

## 29. Export

Bottom sheet:

```text
Resolution
- Original
- 4K
- 2K
- Custom

Format
- JPEG
- PNG
- HEIC
- WebP

Quality
- 60–100

Metadata
- Keep EXIF
- Remove location
- Remove all metadata

Color
- sRGB
- Display P3
```

Map UI vào `ExportEngine`, không để screen tự encode ảnh.

---

# PHẦN G — DATABASE / NON-DESTRUCTIVE EDITING

## 30. Edit record

Persist tối thiểu:

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

Có thể bổ sung:

```text
recipeVersion
rendererVersion
previewAssetId
lastExportPreset
syncState
```

## 31. Không sửa ảnh gốc

Quy tắc bắt buộc:

```text
ORIGINAL IMMUTABLE
```

Không có engine nào được phép overwrite original asset.

Edit luôn tạo:

```text
Original
  + EditRecipe
  + optional Preview
  + optional Exported/Edited Asset
```

## 32. Đồng bộ recipe Mobile → Desktop

Về sau nên sync cả recipe:

```text
Mobile edit
 ↓
EditRecipe JSON
 ↓
Desktop
 ↓
EditRepository
```

Desktop có thể render/export lại bằng renderer tương thích.

Không cần upload một bản JPEG mới sau mỗi lần kéo slider.

Chỉ upload rendered copy khi policy yêu cầu.

---

# PHẦN H — PREVIEW PERFORMANCE

## 33. Không render full resolution khi kéo slider

Đây là yêu cầu quan trọng để Editor mượt.

Nên có ba cấp:

```text
Thumbnail Preview
~256–512 px
→ preset gallery

Interactive Preview
~1080–1600 px
→ slider/crop realtime

Full Resolution
original resolution
→ Save/Export
```

## 34. Render cancellation

Mỗi preview render có `requestId`.

Ví dụ user kéo Exposure liên tục:

```text
render #100
render #101
render #102
render #103
```

Khi #103 được yêu cầu, #100–#102 có thể cancel hoặc kết quả bị bỏ.

Không để render cũ overwrite preview mới.

## 35. Preset thumbnail cache

Không render toàn bộ preset mỗi lần mở panel.

Cache key nên gồm:

```text
assetId
recipeVersion
presetId
presetVersion
intensityBucket
```

Cache invalid khi source/recipe thay đổi.

---

# PHẦN I — DESKTOP PHOTO EDITOR

## 36. Dùng chung recipe

Desktop không tạo format edit riêng.

Cả hai phải dùng:

```text
@photox/image-editor
EditRecipe
```

Desktop UI có thể khác Mobile nhưng engine giống nhau.

```text
Mobile Editor UI ─┐
                  ├→ PhotoEditorSDK → EditRecipe
Desktop Editor UI ┘
```

## 37. Desktop renderer

Desktop có thể dùng:

- native image engine
- WebGL/WebGPU
- WASM
- IMG.LY desktop/web nếu phù hợp

Nhưng phải implement `RendererAdapter`.

Business SDK không import Electron/React.

---

# PHẦN J — UPDATE SDK / CI-CD

## 38. Update check

`@photox/update-core` chỉ chịu trách nhiệm:

```text
fetch manifest
compare version
select artifact
verify metadata/integrity
```

Không để update-core tự quyết định native install.

Desktop installer/update adapter riêng.

iOS phải tuân theo cơ chế phân phối của Apple/TestFlight/App Store; không thiết kế cơ chế tự thay binary iOS ngoài hệ thống được phép.

## 39. CI

Trước khi build app, CI phải chạy:

```bash
npm --workspace @photox/contracts run typecheck
npm --workspace @photox/storage run typecheck
npm --workspace @photox/sync run typecheck
npm --workspace @photox/media run typecheck
npm --workspace @photox/image-editor run build
npm --workspace @photox/image-editor test
npm --workspace @photox/image-editor run typecheck
npm --workspace @photox/desktop-sdk run typecheck
npm --workspace @photox/mobile-sdk run typecheck
```

Sau đó mới build Mobile/Desktop.

---

# PHẦN K — THỨ TỰ TÍCH HỢP KHUYẾN NGHỊ

## 40. Phase 1 — Không thay đổi behavior

- đưa packages vào workspace
- build/typecheck SDK
- tạo adapters
- chưa chuyển UI
- test SDK riêng

## 41. Phase 2 — Mobile media actions

Gắn lần lượt:

1. Download
2. Delete local
3. Delete remote
4. Edit button → Photo Editor screen

Không gắn cả ba trong một commit lớn.

## 42. Phase 3 — Photo Editor cơ bản

Gắn:

1. canvas
2. session
3. Before/After
4. Undo/Redo
5. Presets
6. Adjust Light/Color
7. Crop
8. Save Copy

Sau khi ổn mới thêm HSL/Tone Curve/Retouch/AI.

## 43. Phase 4 — Desktop storage

1. wrap Google Drive legacy
2. register provider
3. local provider
4. migrate replica identity
5. chuyển replica policy sang StoragePolicyEngine
6. chuyển upload/download sang ReplicationService

## 44. Phase 5 — Edit persistence/sync

1. EditRepository Mobile
2. EditRepository Desktop
3. draft persistence
4. recipe sync
5. edited asset relation
6. preview cache

## 45. Phase 6 — Smart/AI editing

Sau khi editor thường ổn mới thêm:

- Smart Preset
- Auto Enhance model
- Heal
- Remove Object
- Face detection/retouch
- denoise
- deblur
- super resolution
- background/sky tools

AI luôn đi qua adapter/plugin contract để có thể thay model sau này.

---

# PHẦN L — CHECKLIST TRƯỚC KHI MERGE MAIN

Mobile:

- [ ] app cũ vẫn mở được
- [ ] pairing cũ không mất
- [ ] sync cũ không bị phá
- [ ] download hoạt động
- [ ] delete permission đúng iOS/Android
- [ ] edit original không bị overwrite
- [ ] undo/redo ổn
- [ ] Save Draft hoạt động
- [ ] Save Copy hoạt động
- [ ] app restart vẫn re-edit được
- [ ] memory không tăng vô hạn khi edit ảnh lớn
- [ ] slider preview không block UI thread

Desktop:

- [ ] Google OAuth cũ vẫn hoạt động
- [ ] Drive account cũ vẫn đọc được
- [ ] media index cũ vẫn đọc được
- [ ] replica legacy được normalize
- [ ] local provider hoạt động
- [ ] target 2 replicas hoạt động
- [ ] account hết dung lượng được bỏ qua
- [ ] download fallback qua replica khác
- [ ] remote webViewLink vẫn mở được

SDK:

- [ ] contracts không phụ thuộc Expo/Electron
- [ ] image-editor không phụ thuộc UI framework
- [ ] provider không chứa UI
- [ ] recipe có version
- [ ] migration strategy tồn tại khi recipe version đổi
- [ ] test pass
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

Chỉ merge về `main` sau khi checklist quan trọng đã pass.

---

# 46. Nguyên tắc kiến trúc cần giữ lâu dài

```text
UI chỉ hiển thị và phát command.
SDK giữ business logic.
Adapter kết nối platform/library/provider.
Original asset luôn immutable.
EditRecipe là nguồn sự thật của chỉnh sửa.
StorageReplica luôn định danh bằng providerId + accountId + remoteFileId.
Mobile và Desktop dùng chung contracts.
Provider mới không được yêu cầu rewrite storage core.
Renderer mới không được yêu cầu rewrite Photo Editor UI/business recipe.
```

Nếu giữ các nguyên tắc này, PhotoX có thể mở rộng storage provider, renderer, AI model và platform mà không phải liên tục viết lại app hiện tại.
