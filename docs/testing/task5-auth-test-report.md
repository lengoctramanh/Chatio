# Báo cáo kiểm thử – Task 5: Xác thực, phiên và phân quyền

| Mục | Nội dung |
|---|---|
| Người thực hiện | Châu Gia Bảo |
| Nhánh | `feature/auth-session-authorization` |
| Lệnh | `cd backend && npm test` |
| Lần chạy 1 – 04/11/2026 | Windows, Node.js LTS, PostgreSQL 18 (Docker): **26/26 đạt** (#1–#26) |
| Lần chạy 2 – 15/11/2026 | Bổ sung TC42, TC56. Linux, Node.js 22, PostgreSQL 16, Chrome 153: **41/41 đạt** |
| Lần chạy 3 – 15/11/2026 | Windows, Node.js 26, PostgreSQL 18 (Docker): **41/41 đạt** (#1–#26, TC42, TC56), khoảng 7,3 giây |
| Người kiểm tra độc lập | _(thành viên review điền)_ |

Định danh tài khoản: nhóm đã chốt dùng **username**, không yêu cầu email.

Test tự động nằm ở `backend/tests/auth.test.js` (#1–#26) và `backend/tests/security.test.js` (TC42, TC56). Mỗi test xóa sạch dữ liệu `users`, `sessions`, `audit_logs` trong `chatio_test` rồi tự chuẩn bị dữ liệu, nên các test chạy độc lập với nhau. Mật khẩu mẫu trong test là `correct-horse-battery-staple`.

## Kết quả chi tiết

| # | Yêu cầu SRS | Trường hợp | Dữ liệu đầu vào | Kết quả mong đợi | Thực tế |
|---|---|---|---|---|---|
| 1 | ACC-01, SEC-01 | Admin tạo tài khoản | Phiên admin + CSRF, `{username: "alice", password: 24 ký tự}` | 201; `mustChangePassword = true`; không trả hash; DB lưu `$argon2id$...` | Đạt |
| 2 | ACC-01 | Username đã tồn tại | Tạo lại `alice` | 409 `USERNAME_TAKEN` | Đạt |
| 3 | SEC-01 | Mật khẩu < 15 ký tự | `password: "short-pass"` | 400 | Đạt |
| 4 | ACC-01 | Đăng ký công khai | Gọi `/register` không có phiên | 401 | Đạt |
| 5 | SEC-03 | User thường tạo tài khoản | Phiên user + CSRF | 403 | Đạt |
| 6 | ACC-04 | Thiếu CSRF token | Phiên admin, không có header `X-CSRF-Token` | 403 `CSRF_INVALID` | Đạt |
| 7 | SEC-02 | Đăng nhập đúng | Username và mật khẩu đúng | 200; cookie `HttpOnly`, `Secure`, `SameSite=Strict`; có `csrfToken`; DB chỉ lưu hash của token | Đạt |
| 8 | ACC-03 | Sai mật khẩu / username không tồn tại | Sai mật khẩu; username `nobody` | Cả hai trả 401 với cùng nội dung; không set cookie | Đạt |
| 9 | ACC-03 | Tài khoản bị khóa | `status = locked`, mật khẩu đúng | 401 `INVALID_CREDENTIALS` (giống sai mật khẩu) | Đạt |
| 10 | SEC-01 | Dò mật khẩu | Sai 5 lần rồi nhập đúng | 429 kèm `Retry-After` | Đạt |
| 11 | FR-05, SEC-07 | Ghi nhật ký đăng nhập | 1 lần sai, 1 lần đúng | `LOGIN:failure`, `LOGIN:success`; log không chứa mật khẩu | Đạt |
| 12 | SEC-03 | Chưa đăng nhập | `GET /me` không có cookie | 401 | Đạt |
| 13 | FR-01 | Lấy thông tin cá nhân | `GET /me` có phiên hợp lệ | 200; có `csrfToken`; không có hash | Đạt |
| 14 | SEC-02 | Token giả mạo | Cookie `chatio_sid` = 43 ký tự `A` | 401 | Đạt |
| 15 | SEC-02 | Quá 15 phút không hoạt động | `last_activity_at` lùi 16 phút | 401 | Đạt |
| 16 | SEC-02 | Quá hạn tuyệt đối | `expires_at` đã qua | 401 | Đạt |
| 17 | ACC-03 | Khóa tài khoản khi đang đăng nhập | Đăng nhập rồi đặt `status = locked` | Phiên cũ bị từ chối, 401 | Đạt |
| 18 | ACC-01 | Bắt buộc đổi mật khẩu lần đầu | `must_change_password = true` | `/me` trả 200; API khác trả 403 `PASSWORD_CHANGE_REQUIRED` | Đạt |
| 19 | SEC-03 | Admin vào API admin | Phiên admin, `GET /api/admin/ping` | 200 | Đạt |
| 20 | SEC-03, FR-05 | User vào API admin | Phiên user, `GET /api/admin/ping` | 403; ghi `ACCESS_DENIED` | Đạt |
| 21 | SEC-03 | Chưa đăng nhập vào API admin | Không có cookie | 401 | Đạt |
| 22 | ACC-03 | Dùng lại phiên sau khi đăng xuất | Logout rồi gọi `/me` bằng cookie cũ | Logout trả 204, xóa cookie, `revoked_at` có giá trị; `/me` trả 401 | Đạt |
| 23 | ACC-04 | Đăng xuất với CSRF giả | `X-CSRF-Token: forged` | 403; phiên vẫn còn hiệu lực | Đạt |
| 24 | SEC-02 | Đăng xuất một thiết bị | 2 phiên, logout phiên A | Phiên B vẫn dùng được | Đạt |
| 25 | ACC-03 | Đổi mật khẩu | 2 phiên, đổi mật khẩu từ phiên A | Cả 2 phiên bị thu hồi; mật khẩu cũ trả 401; mật khẩu mới đăng nhập được; `mustChangePassword = false` | Đạt |
| 26 | FR-01 | Sai mật khẩu hiện tại khi đổi | `currentPassword` sai | 401; phiên và mật khẩu không đổi | Đạt |

## Đối chiếu với yêu cầu kiểm thử trong task

| Yêu cầu của task | Test |
|---|---|
| Đăng ký thành công | #1 |
| Username đã tồn tại (nhóm chốt không dùng email) | #2 |
| Đăng nhập đúng và sai mật khẩu | #7, #8 |
| Truy cập API khi chưa đăng nhập | #12, #21 |
| Phiên/token không hợp lệ hoặc hết hạn | #14, #15, #16 |
| `user` truy cập API chỉ dành cho `admin` | #5, #20 |
| Đăng xuất xong không dùng lại phiên được | #22 |

## TC42 – SQL Injection vào username khi đăng nhập

**Yêu cầu:** SEC-04 (tham số hóa truy vấn chống SQL Injection), ACC-03.
**Mục tiêu:** chứng minh (1) không đăng nhập vượt quyền, (2) không thay đổi dữ liệu, (3) API xử lý như thông tin đăng nhập không hợp lệ, (4) truy vấn dùng tham số.

**Dữ liệu chuẩn bị:** tài khoản `admin` (role `admin`) và `alice` (role `user`), mật khẩu `correct-horse-battery-staple`.

**Payload đưa vào trường `username`** (đều ≤ 50 ký tự để thực sự đi tới truy vấn CSDL):

| Payload | Mục đích nếu SQL bị ghép chuỗi |
|---|---|
| `' OR '1'='1' --` | Điều kiện luôn đúng, lấy user đầu tiên |
| `' OR 1=1 --` | Như trên |
| `admin'--` | Cắt phần còn lại của câu lệnh để vào thẳng `admin` |
| `admin' OR '1'='1` | Điều kiện luôn đúng |
| `' UNION SELECT * FROM users --` | Ghép dữ liệu bảng khác |
| `'; DROP TABLE users; --` | Xóa bảng |
| `'; UPDATE users SET global_role='admin'; --` | Nâng quyền mọi tài khoản |
| `'; DELETE FROM sessions; --` | Xóa phiên |

| Bước kiểm tra | Kết quả mong đợi | Thực tế |
|---|---|---|
| Gửi từng payload với mật khẩu bất kỳ | `401 INVALID_CREDENTIALS`, body giống hệt khi sai mật khẩu, không có cookie `chatio_sid` | Đạt |
| `admin'--`, `admin' --`, `' OR username='admin' --` kèm **mật khẩu đúng** của admin | 401, không vào được tài khoản admin | Đạt |
| Đưa `' OR '1'='1' --` vào trường **mật khẩu** của `admin` | 401 (mật khẩu chỉ được so bằng Argon2, không vào SQL) | Đạt |
| So sánh bảng `users` trước và sau (id, username, role, status, hash, `must_change_password`, `updated_at`) | Không thay đổi; bảng `users`, `sessions` vẫn tồn tại; `alice` vẫn là `user`; `sessions` = 0 | Đạt |
| Ghi lại mọi câu SQL backend gửi tới PostgreSQL khi đăng nhập với `' OR '1'='1' --` | Có truy vấn `... FROM users WHERE username = $1` với `values = ["' OR '1'='1' --"]`; payload không xuất hiện trong bất kỳ câu SQL nào | Đạt |

**Truy vấn dùng tham số** (`backend/src/models/user.js`):

```js
export const findUserByUsernameWithHash = async (username, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
};
```

`pg` gửi câu SQL và giá trị tách rời nhau (extended query protocol), nên PostgreSQL chỉ coi payload là một chuỗi username, không bao giờ là câu lệnh. `PUBLIC_COLUMNS` là hằng số trong code, không lấy từ người dùng.

**Kiểm chứng ngược:** tạm sửa truy vấn thành ghép chuỗi (`WHERE username = '${username}'`) thì 4/6 test TC42 thất bại. Cụ thể: các payload `'; UPDATE ...`, `'; DROP TABLE ...` được PostgreSQL thực thi và làm thay đổi CSDL; API trả lỗi 500 thay vì 401; `admin'--` được chấp nhận như username `admin`; và test bắt được payload nằm trong câu SQL. Như vậy bộ test phát hiện được lỗ hổng thật. Đã hoàn tác ngay sau khi kiểm chứng.

## TC56 – Trang web khác gửi yêu cầu đăng nhập (login CSRF)

**Yêu cầu:** ACC-04, SEC-04.
**Rủi ro:** một website độc hại tự gửi form đăng nhập bằng tài khoản của kẻ tấn công. Nạn nhân bị đăng nhập vào tài khoản đó mà không biết, rồi gửi tin nhắn hoặc file vào tài khoản của kẻ tấn công.

**Cơ chế bảo vệ:**
1. `rejectCrossSiteRequests` (`backend/src/middleware/sameOrigin.js`) chặn mọi `POST/PUT/PATCH/DELETE` tới `/api`, kể cả `/login` (chưa có phiên), khi trình duyệt gửi `Sec-Fetch-Site: cross-site`, hoặc `Origin: null`, hoặc `Origin` không thuộc backend/`ALLOWED_ORIGINS`. Trả `403 CROSS_SITE_REQUEST` và ghi `ACCESS_DENIED`.
2. `/login` chỉ nhận `application/json`. Form HTML chỉ gửi được urlencoded/multipart/text/plain, nên bị trả `415`.
3. Backend không bật CORS, nên trình duyệt không cho trang khác gửi JSON kèm cookie (preflight thất bại).
4. Cookie phiên `SameSite=Strict`.

### a) Kiểm thử bằng trình duyệt thật

- **Cách làm:** trang tấn công `docs/testing/tc56-login-csrf/attacker.html` chạy ở `http://127.0.0.1:8081`, backend chạy ở `http://localhost:3000` (hai site khác nhau). Tài khoản `attacker` có mật khẩu đúng.
- **Công cụ:** Chrome 153 headless, điều khiển bằng Puppeteer. Header lấy từ DevTools Protocol, số phiên lấy từ CSDL sau mỗi bước.
- **Hướng dẫn tự làm lại bằng tay:** `docs/testing/tc56-login-csrf/README.md`.

| Kịch bản | Header trình duyệt gửi | Kết quả thực tế | Cookie `chatio_sid` | Phiên trong CSDL |
|---|---|---|---|---|
| A. Form ẩn tự submit (urlencoded) | `Origin: http://127.0.0.1:8081`, `Sec-Fetch-Site: cross-site`, `Sec-Fetch-Mode: navigate` | Trình duyệt chuyển sang `localhost:3000/api/auth/login`, nhận **403** `CROSS_SITE_REQUEST` | Không có | 0 |
| B. `fetch` JSON, `credentials: 'include'` | Preflight `OPTIONS` | Trình duyệt chặn: `TypeError: Failed to fetch`; request `POST` không tới backend | Không có | 0 |
| C. `fetch` no-cors, `text/plain` chứa JSON | `Origin: http://127.0.0.1:8081`, `Sec-Fetch-Site: cross-site` | Backend trả **403**; trang tấn công chỉ nhận phản hồi opaque | Không có | 0 |
| D. Đối chứng: đăng nhập từ chính origin của backend | Same-origin | **200**, có cookie | Có | 1 |

- **Nhật ký:** sau A–C, `audit_logs` có đúng 2 dòng `ACCESS_DENIED` (từ A và C) với `reason: sec_fetch_site_cross_site`, `origin: http://127.0.0.1:8081`. Không có dòng `LOGIN` nào, vì request bị chặn trước khi kiểm tra mật khẩu.
- **Kết luận:** trang web khác không thể đăng nhập hộ người dùng. Luồng đăng nhập hợp lệ vẫn hoạt động. **Đạt.**

### b) Kiểm thử tự động (`npm test`, nhóm TC56)

| Trường hợp | Dữ liệu đầu vào | Mong đợi | Thực tế |
|---|---|---|---|
| Form tự submit từ trang khác | `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site`, urlencoded, mật khẩu đúng | 403, không cookie, 0 phiên | Đạt |
| `fetch` no-cors text/plain | Như trên, `Content-Type: text/plain`, body JSON | 403, 0 phiên | Đạt |
| Trình duyệt không gửi `Sec-Fetch-Site` | Chỉ có `Origin: https://evil.example`, JSON, mật khẩu đúng | 403, 0 phiên | Đạt |
| `Origin: null` | file://, iframe sandbox | 403 | Đạt |
| Trình duyệt cũ không gửi `Origin`/`Sec-Fetch-*` | Form urlencoded | 415, 0 phiên | Đạt |
| Ghi nhật ký | Request bị chặn | 1 dòng `ACCESS_DENIED` có origin, không chứa mật khẩu | Đạt |
| Đối chứng: frontend Vite | `Origin: http://localhost:5173`, `Sec-Fetch-Site: same-origin` | 200, có cookie | Đạt |
| Đối chứng: cùng origin với backend | `Host: chat.local:3000`, `Origin: http://chat.local:3000` | 200 | Đạt |
| Logout từ trang khác | Cookie + CSRF token hợp lệ, `Origin: https://evil.example` | 403, phiên vẫn còn | Đạt |

**Kiểm chứng ngược:** tạm bỏ `rejectCrossSiteRequests` thì 6/9 test TC56 thất bại. Đã hoàn tác.

## Kiểm thử thủ công bổ sung

Chạy server thật và gọi bằng curl theo luồng: tạo admin bằng `npm run create-admin` → đăng nhập → gọi `/api/admin/ping` (403 `PASSWORD_CHANGE_REQUIRED`) → đổi mật khẩu → gọi `/me` bằng cookie cũ (401). Kết quả: đúng như mong đợi.

## Ghi chú

- Danh sách origin hợp lệ cấu hình bằng `ALLOWED_ORIGINS` (mặc định `http://localhost:5173`). Khi triển khai phải đặt đúng địa chỉ thật của website, nếu không frontend sẽ nhận 403.

- `npm audit`: còn 3 lỗi mức moderate trong `glob`/`minimatch`. Đây là thư viện phụ của `node-pg-migrate`, chỉ dùng khi chạy migration, không chạy trong backend. Lỗi high của `body-parser` đã được cập nhật lên bản vá 2.4.0.
- Chưa kiểm thử: ngắt kết nối Socket.IO khi phiên bị thu hồi (thuộc task chat), và chạy qua HTTPS thật (sẽ kiểm tra khi triển khai).
