# API xác thực, phiên và phân quyền

Theo SRS: FR-01, SEC-01, SEC-02, SEC-03, SEC-04, ACC-01 → ACC-04.

## Thiết kế

- **Phiên lưu trong CSDL** (bảng `sessions`), không dùng JWT. Khi đăng nhập, backend sinh token ngẫu nhiên 32 byte, đặt vào cookie `chatio_sid` (`HttpOnly`, `Secure`, `SameSite=Strict`). CSDL chỉ lưu SHA-256 của token.
- **Hết hạn:** sau 15 phút không hoạt động (`last_activity_at`, tự gia hạn mỗi request), và tối đa 8 giờ kể từ lúc đăng nhập (`expires_at`).
- **Thu hồi:** đặt `revoked_at`. Đăng xuất thu hồi phiên hiện tại; đổi mật khẩu thu hồi mọi phiên của user. Phiên của tài khoản có `status` khác `active` bị từ chối ngay ở request kế tiếp.
- **Không có `/auth/refresh`:** phiên trong CSDL tự gia hạn khi người dùng còn hoạt động nên không cần cặp access/refresh token.
- **Mật khẩu:** Argon2id, tối thiểu 15 ký tự.
- **Chống dò mật khẩu:** tối đa 5 lần sai/tài khoản và 20 lần sai/IP trong 15 phút, vượt quá trả `429` kèm `Retry-After`. Bộ đếm nằm trong bộ nhớ tiến trình (đủ cho một instance backend).
- **CSRF:** mọi request thay đổi dữ liệu (trừ login) phải gửi header `X-CSRF-Token`. Token lấy từ response của `/login` hoặc `/me`, gắn với phiên hiện tại.
- **Không đăng ký công khai:** `/auth/register` chỉ dành cho admin. Tài khoản mới có `must_change_password = true`.
- **Nhật ký:** ghi `LOGIN`, `LOGOUT`, `PASSWORD_CHANGE`, `ACCOUNT_CREATE`, `ACCESS_DENIED` vào `audit_logs`. Không ghi mật khẩu, token hay hash.

Định dạng lỗi chung: `{ "error": { "code": "...", "message": "..." } }`.

## Endpoint

| Method & path | Yêu cầu | Mô tả |
|---|---|---|
| `POST /api/auth/login` | — | Đăng nhập |
| `POST /api/auth/logout` | cookie + CSRF | Thu hồi phiên hiện tại |
| `GET /api/auth/me` | cookie | Thông tin user + CSRF token |
| `POST /api/auth/change-password` | cookie + CSRF | Đổi mật khẩu, thu hồi mọi phiên |
| `POST /api/auth/register` | admin + CSRF | Admin tạo tài khoản |
| `GET /api/admin/ping` | admin | API thử middleware phân quyền |

### `POST /api/auth/login`

```json
{ "username": "alice", "password": "mat-khau-it-nhat-15-ky-tu" }
```

- `200`: set cookie `chatio_sid`, trả `{ user, csrfToken, expiresAt }`. Nếu `user.mustChangePassword` là `true`, frontend chuyển sang trang đổi mật khẩu.
- `400`: thiếu username/password.
- `401 INVALID_CREDENTIALS`: sai thông tin, tài khoản không tồn tại hoặc bị khóa (cùng một thông báo).
- `429 TOO_MANY_ATTEMPTS`: vượt giới hạn thử sai.

### `POST /api/auth/logout`

Header `X-CSRF-Token`. Trả `204` và xóa cookie. Trả `403 CSRF_INVALID` nếu phiên hợp lệ nhưng sai token (phiên không bị thu hồi). Nếu phiên đã không còn hợp lệ thì chỉ xóa cookie và trả `204`.

### `GET /api/auth/me`

`200`: `{ user, csrfToken }`. `401`: chưa đăng nhập, phiên hết hạn hoặc đã bị thu hồi.

### `POST /api/auth/change-password`

```json
{ "currentPassword": "...", "newPassword": "..." }
```

- `200`: đổi thành công, mọi phiên bị thu hồi, phải đăng nhập lại.
- `400`: mật khẩu mới ngắn hơn 15 ký tự hoặc trùng mật khẩu cũ.
- `401 INVALID_CURRENT_PASSWORD`: sai mật khẩu hiện tại.

### `POST /api/auth/register` (admin)

```json
{ "username": "alice", "password": "mat-khau-khoi-tao-15-ky-tu", "role": "user" }
```

`role` là `user` (mặc định) hoặc `admin`. Trả `201 { user }`, `400` nếu dữ liệu không hợp lệ, `409 USERNAME_TAKEN` nếu username đã tồn tại, `401`/`403` nếu không phải admin hoặc thiếu CSRF.

## Dùng middleware trong module khác

```js
import { requireAuth, requireCsrf, requireRole } from '../middleware/auth.js';

router.get('/conversations', requireAuth, handler);                    // đã đăng nhập
router.post('/messages', requireAuth, requireCsrf, handler);           // thay đổi dữ liệu
router.post('/admin/users/:id/lock', requireAuth, requireRole('admin'), requireCsrf, handler);
```

- Sau `requireAuth`: `req.user = { id, username, role, status, mustChangePassword }`, `req.sessionId`.
- `requireAuth` trả `401` khi không có phiên hợp lệ, `403 PASSWORD_CHANGE_REQUIRED` khi tài khoản chưa đổi mật khẩu lần đầu.
- `requireRole('admin')` trả `403` và ghi `ACCESS_DENIED` vào nhật ký.
- Khi khóa tài khoản hoặc admin đặt lại mật khẩu, gọi `revokeAllUserSessions(userId, client)` trong `src/lib/sessions.js` (ACC-03).
- Socket.IO: lấy cookie `chatio_sid` từ handshake và gọi `findActiveSession(token)` để xác thực, kiểm tra lại ở từng event.

## Thử nhanh bằng curl

```bash
curl -c cj -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"..."}'
# Lấy csrfToken trong response
curl -b cj http://localhost:3000/api/auth/me
curl -b cj -X POST http://localhost:3000/api/auth/logout -H "X-CSRF-Token: <csrfToken>"
```

Lưu ý: PowerShell có alias `curl` trỏ tới `Invoke-WebRequest`, nên dùng `curl.exe`.
