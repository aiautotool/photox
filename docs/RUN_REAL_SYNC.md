# PhotoX real sync: Mobile → Internet Tunnel → Desktop

## Kiến trúc

```text
Phone Photos / MediaStore
        ↓
PhotoX Mobile
        ↓ HTTPS + workspace session
PhotoX Relay / Reverse Tunnel
        ↓ WSS notification + streamed delivery
PhotoX Desktop Edge
        ├── SQLite media catalog authority
        ├── Pictures/PhotoX/... local originals
        └── Storage / Replica Manager
              ├── Local
              ├── Google Drive 1..N
              └── Telegram / other providers
```

Mobile không tự quyết định quota Google Drive. Desktop/edge là data-plane node quản lý provider allocation và replica policy theo workspace.

## 1. Chạy relay

```bash
npm install
npm run relay
```

Mặc định relay nghe `:8787`.

### Expose relay bằng Cloudflare Tunnel

Development nhanh:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Production nên dùng **named Cloudflare Tunnel + hostname cố định**, ví dụ:

```text
https://relay.photox.example.com
```

Cloudflare Tunnel dùng kết nối outbound-only nên relay server không cần mở inbound port trực tiếp. Public Web deployment phải cấu hình trusted proxy/origin/session policy theo `docs/WEB_DEPLOYMENT.md`; không tin `X-Forwarded-*` từ client trực tiếp.

## 2. Desktop

```bash
cp desktop/.env.example desktop/.env
```

Đặt relay URL cố định:

```env
PHOTOSYNC_RELAY_URL=https://relay.photox.example.com
```

Nếu dùng Google Drive pool, thêm OAuth Desktop Client theo cấu hình hiện tại của app:

```env
PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_ID=...
PHOTOSYNC_GOOGLE_DESKTOP_CLIENT_SECRET=...
```

Chạy:

```bash
npm run desktop
```

Desktop duy trì device/workspace identity, kết nối outbound WSS tới relay và UI hiển thị QR pairing. Pairing v2 đổi short-lived challenge thành access/refresh session có workspace scope; v1 pair-code/pair-token chỉ còn tương thích tạm cho client cũ.

## 3. Mobile pairing

Mobile mở tab **Máy tính** → **Quét QR từ laptop**.

Với pairing v2, QR chứa workspace/device/challenge metadata cần để đổi lấy session có scope. Mobile lưu session cần thiết bằng Expo SecureStore/Keychain và tự refresh access token trước khi hết hạn. QR chỉ cần quét lại khi thiết bị/session bị quên hoặc revoke.

## 4. Các lần sau

```text
Desktop bật
  ↓
Desktop tự nối WSS tới relay
  ↓
Relay đánh dấu edge node online

Mobile mở / trở lại foreground / background task được OS chạy
  ↓
Refresh/kiểm tra workspace session
  ↓
Kiểm tra desktop online
  ↓
Tự gửi media chưa đồng bộ
  ↓
Relay giữ/forward request theo authenticated transport
  ↓
Desktop ingest local + SHA-256 + tenant-scoped catalog/job state
  ↓
Storage Manager phân phối replica theo provider policy
```

Không cần cùng Wi‑Fi và không cần quét QR lại trong session/device lifecycle bình thường.

## 5. Background behavior

- Android/iOS quyết định thời điểm background task thực sự được chạy.
- Khi app quay lại foreground, sync có thể chạy ngay nếu edge node/session hợp lệ.
- iOS không đảm bảo background task chạy đúng ngay lúc laptop vừa bật.
- Muốn wake-up gần realtime khi iPhone đang suspended lâu, dùng push trigger được thiết kế phù hợp (APNs/FCM/Expo Push), sau đó vẫn đi qua authenticated sync path bình thường.

## 6. Storage rule phía Desktop

Google Drive **không có fixed 10 GiB PhotoX cap**.

Cho mỗi account:

```text
allocationRatio = configuredRatio ?? 2/3
allocationLimit = floor(authoritativeProviderTotalBytes * allocationRatio)
ratioRemaining = max(0, allocationLimit - photoXAppUsedBytes)
providerRemainingAfterReserve = max(0, authoritativeProviderFreeBytes - safetyReserveBytes)
safeAvailable = min(ratioRemaining, providerRemainingAfterReserve)
```

- `allocationRatio` cấu hình riêng từng account, mặc định `2/3`.
- `safetyReserveBytes` cấu hình riêng từng account.
- Provider free/total phải lấy từ quota authoritative của Google.
- File không bị chia nhỏ qua nhiều account; chỉ chọn account có `safeAvailable >= fileSize`.
- Nếu authoritative total tạm thời không có, PhotoX không được tự thay bằng cap 10 GiB; vẫn phải chặn theo actual free bytes trừ safety reserve.
- Nếu không Drive nào hợp lệ, original đã ingest vẫn nằm an toàn ở nguồn durable hiện có và cloud/replication job ở trạng thái blocked/retryable trung thực.

## 7. Catalog runtime

Desktop sử dụng SQLite làm media-catalog authority. `media-index.json` chỉ là legacy one-time import source trong cutover hoặc JSON offline recovery artifact; không chạy song song như live writer.

## 8. Google Photos migration

Nguồn Google Photos chỉ dùng các item người dùng chọn qua current Google Photos Picker API. Không được mô tả tính năng như full-library crawl. Selected media được stage durable trước khi Picker session hết hiệu lực, sau đó transfer theo migration ledger tới Google Photos destination dạng append-only hoặc tới Google Drive account đã kết nối, có progress/pause/resume/retry/verification.
