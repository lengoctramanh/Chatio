# Báo cáo kiểm thử – Task 5: Xác thực, phiên và phân quyền

| Mục | Nội dung |
|---|---|
| Người thực hiện | Châu Gia Bảo |
| Nhánh | `feature/auth-session-authorization` |
| Ngày chạy | 04/11/2026 |
| Môi trường | Windows, Node.js LTS, PostgreSQL 18 (Docker), CSDL `chatio_test` |
| Lệnh | `cd backend && npm test` |
| Kết quả | **26/26 đạt**, 0 lỗi (khoảng 3,7 giây) |
| Người kiểm tra độc lập | _(thành viên review điền)_ |

Test tự động nằm ở `backend/tests/auth.test.js`. Mỗi test xóa sạch dữ liệu `users`, `sessions`, `audit_logs` trong `chatio_test` rồi tự chuẩn bị dữ liệu, nên các test chạy độc lập với nhau. Mật khẩu mẫu trong test là `correct-horse-battery-staple`.

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
| Email hoặc username đã tồn tại | #2 (hệ thống chỉ dùng username theo SRS) |
| Đăng nhập đúng và sai mật khẩu | #7, #8 |
| Truy cập API khi chưa đăng nhập | #12, #21 |
| Phiên/token không hợp lệ hoặc hết hạn | #14, #15, #16 |
| `user` truy cập API chỉ dành cho `admin` | #5, #20 |
| Đăng xuất xong không dùng lại phiên được | #22 |

## Kiểm thử thủ công bổ sung

Chạy server thật và gọi bằng curl theo luồng: tạo admin bằng `npm run create-admin` → đăng nhập → gọi `/api/admin/ping` (403 `PASSWORD_CHANGE_REQUIRED`) → đổi mật khẩu → gọi `/me` bằng cookie cũ (401). Kết quả: đúng như mong đợi.

## Ghi chú

- `npm audit`: còn 3 lỗi mức moderate trong `glob`/`minimatch`. Đây là thư viện phụ của `node-pg-migrate`, chỉ dùng khi chạy migration, không chạy trong backend. Lỗi high của `body-parser` đã được cập nhật lên bản vá 2.4.0.
- Chưa kiểm thử: ngắt kết nối Socket.IO khi phiên bị thu hồi (thuộc task chat), và chạy qua HTTPS thật (sẽ kiểm tra khi triển khai).
