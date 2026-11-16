# TC56 – Tự kiểm tra login CSRF bằng trình duyệt

`attacker.html` mô phỏng một website độc hại cố đăng nhập vào Chatio bằng tài khoản của kẻ tấn công. Trang này chỉ dùng để kiểm thử trên máy dev.

## Chuẩn bị

1. Chạy backend ở `http://localhost:3000`, ví dụ `docker compose up -d` hoặc `npm run dev` trong `backend`.
2. Có sẵn một tài khoản để thử, ví dụ `attacker` (tạo bằng `npm run create-admin -- attacker` hoặc qua `/api/auth/register`).
3. Mở trang tấn công từ **một site khác** với backend. `127.0.0.1` và `localhost` được trình duyệt coi là hai site khác nhau:

   ```powershell
   cd docs/testing/tc56-login-csrf
   npx serve -l tcp://127.0.0.1:8081
   ```

4. Mở `http://127.0.0.1:8081/attacker.html?u=attacker&p=<mat_khau>` trong trình duyệt. Bật DevTools (F12), tab Network.

## Các bước và kết quả mong đợi

| Nút | Kết quả mong đợi |
|---|---|
| 1. Form HTML tự submit | Trình duyệt chuyển sang `localhost:3000/api/auth/login` và hiện `{"error":{"code":"CROSS_SITE_REQUEST",...}}` (HTTP 403). Không có cookie `chatio_sid` (DevTools, Application, Cookies). |
| 2. fetch JSON có cookie | Trang ghi `trình duyệt chặn (TypeError: Failed to fetch)`. Tab Network chỉ có preflight `OPTIONS`; request `POST` không được gửi. |
| 3. fetch text/plain (no-cors) | Request `POST` tới backend nhận 403 (xem trong tab Network). Trang tấn công không đọc được phản hồi. |

Sau cả ba bước:
- Bảng `sessions` không có phiên mới.
- Bảng `audit_logs` có dòng `ACCESS_DENIED` với `origin: http://127.0.0.1:8081`.
- Không có dòng `LOGIN` nào, vì request bị chặn trước khi kiểm tra mật khẩu.

Truy vấn kiểm tra trong DBeaver:

```sql
SELECT count(*) FROM sessions;
SELECT event_type, outcome, metadata_redacted, created_at FROM audit_logs ORDER BY id DESC LIMIT 5;
```

Kiểm thử tự động tương ứng nằm trong `backend/tests/security.test.js` (nhóm `TC56`).
