# Task 6B — Hướng dẫn chạy và kiểm thử chat nhóm & quản lý thành viên (PowerShell)

## A. Chuẩn bị nhánh và môi trường

1. Đảm bảo đang đứng ở nhánh làm việc `feature/group-chat-membership` cập nhật từ `main`:

```powershell
git fetch origin
git status
git switch feature/group-chat-membership
```

2. Khởi động container PostgreSQL từ thư mục gốc dự án và kiểm tra file `.env` có đủ `DATABASE_URL` (trỏ tới `chatio`) và `TEST_DATABASE_URL` (trỏ tới `chatio_test`):

```powershell
docker compose up -d db
docker compose ps
```

3. Chạy migration mới của Task 6B (`1793620000000_group-chat-name.js`) bằng quyền quản trị CSDL (nếu chưa chạy):

```powershell
cd backend
npm.cmd ci
$env:DATABASE_URL = Read-Host 'URL migration admin cho database chatio'
npm.cmd run db:migrate
Remove-Item Env:DATABASE_URL
```

*(Lưu ý: Không trỏ biến migration vào `chatio_test` và không lưu mật khẩu CSDL vào các file được commit).*

## B. Chạy kiểm thử tự động (77 tests)

Tại thư mục `backend`, chạy toàn bộ bộ test (bao gồm Task 5, Task 6A và `tests/group-chat.test.js` của Task 6B):

```powershell
# đang ở backend/
npm.cmd test
```

Hoặc chạy riêng file kiểm thử của Task 6B:

```powershell
node --test tests/group-chat.test.js
```

**Kết quả kỳ vọng:** Toàn bộ **77 test** đều pass (`# fail 0`), bao gồm các nhóm kịch bản:
- Tạo nhóm thành công với `owner` và danh sách thành viên; rollback toàn bộ transaction nếu phát sinh lỗi giữa chừng.
- Từ chối tên nhóm rỗng, ID thành viên sai/trùng lặp, tự thêm chính mình hoặc thêm tài khoản `locked`.
- `GET /api/conversations` chỉ liệt kê nhóm còn tham gia (`left_at IS NULL`) và ẩn nhóm ngay sau khi bị xóa.
- Quản lý thành viên: chỉ `owner` mới được thêm/xóa; chống thêm trùng khi gửi 5 request đồng thời (1 request `201`, 4 request `409`); hỗ trợ xóa và thêm lại (`rejoin`) với mốc `joined_at` mới nhưng chặn đọc tin nhắn trong thời gian vắng mặt.
- Gửi tin nhóm đồng thời với thao tác xóa thành viên (race condition) không tạo tin nhắn trái quyền; áp dụng rate limit 30 tin/phút (`429`).

## C. Kiểm thử thủ công API qua PowerShell

Khởi động server backend tại thư mục `backend`:

```powershell
npm.cmd run dev
```

Mở một cửa sổ PowerShell khác, đăng nhập 3 tài khoản hợp lệ (`owner`, `bob`, `charlie`) và thử luồng tạo nhóm, thêm/xóa thành viên, gửi tin nhắn:

```powershell
$base = 'http://localhost:3000'
$ownerSess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$bobSess   = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$charSess  = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$owner = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $ownerSess -ContentType 'application/json' -Body (@{username='owner'; password='NHAP_MAT_KHAU'} | ConvertTo-Json)
$bob   = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $bobSess   -ContentType 'application/json' -Body (@{username='bob'; password='NHAP_MAT_KHAU'} | ConvertTo-Json)
$char  = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $charSess  -ContentType 'application/json' -Body (@{username='charlie'; password='NHAP_MAT_KHAU'} | ConvertTo-Json)

# 1. Tạo nhóm mới với Bob
$createBody = @{ name = 'Nhóm Đồ Án 6B'; memberIds = @($bob.user.id) } | ConvertTo-Json
$group = Invoke-RestMethod -Method Post -Uri "$base/api/conversations/groups" -WebSession $ownerSess -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$owner.csrfToken} -Body $createBody
$groupId = $group.conversation.id

# 2. Xem danh sách thành viên nhóm
Invoke-RestMethod -Method Get -Uri "$base/api/conversations/$groupId/members" -WebSession $bobSess

# 3. Chủ nhóm thêm Charlie vào nhóm
$addBody = @{ userId = $char.user.id } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/conversations/$groupId/members" -WebSession $ownerSess -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$owner.csrfToken} -Body $addBody

# 4. Gửi tin nhắn trong nhóm
$msgBody = @{ conversationId = $groupId; clientMsgId = [guid]::NewGuid().ToString(); bodyText = 'Chào cả nhóm!' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/conversations/$groupId/messages" -WebSession $bobSess -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$bob.csrfToken} -Body $msgBody

# 5. Chủ nhóm xóa Bob khỏi nhóm
Invoke-RestMethod -Method Delete -Uri "$base/api/conversations/$groupId/members/$($bob.user.id)" -WebSession $ownerSess -Headers @{'X-CSRF-Token'=$owner.csrfToken}
```

Kiểm tra dữ liệu trong PostgreSQL (`chatio` dev) qua DBeaver:

```sql
SELECT id, type, name, created_by FROM conversations WHERE type = 'group' ORDER BY created_at DESC LIMIT 10;
SELECT conversation_id, user_id, member_role, joined_at, left_at FROM conversation_members ORDER BY joined_at DESC LIMIT 20;
```

## D. Các trường hợp bảo mật cần kiểm tra

1. **Phân quyền chủ nhóm (Authorization):**
   - Thành viên thường (`member`) hoặc tài khoản quản trị hệ thống (`role = 'admin'`) nhưng không phải `owner` của nhóm gọi `POST /members` hoặc `DELETE /members/:userId` -> phải trả về `403 FORBIDDEN`.
   - Người ngoài nhóm (kể cả `admin` toàn hệ thống) gọi `GET /api/conversations/:id` hoặc `GET /api/conversations/:id/members` -> phải trả về `403 FORBIDDEN`.
   - Chủ nhóm tự xóa chính mình (`DELETE /members/:ownerId`) -> phải trả về `400 VALIDATION_ERROR`.
2. **Chống leo thang đặc quyền qua Payload:**
   - Gửi kèm `"ownerId"` hoặc `"memberRole": "owner"` trong body `POST /api/conversations/groups` -> server bỏ qua, người tạo vẫn là `owner` duy nhất và các thành viên được mời luôn là `member`.
3. **Thu hồi quyền tức thì sau khi rời nhóm:**
   - Ngay sau khi `left_at` được cập nhật, thành viên bị xóa gọi `POST /messages` hoặc đọc tin nhắn nhóm -> phải bị từ chối `403 FORBIDDEN`.
   - Nếu được thêm lại vào nhóm (`rejoin`), chỉ được truy cập nội dung từ mốc `joined_at` mới trở đi.
4. **Chống CSRF, XSS, SQLi và bảo vệ Audit Log:**
   - Các request `POST` / `DELETE` thiếu hoặc sai `X-CSRF-Token` -> trả về `403 CSRF_INVALID`.
   - Nội dung tin nhắn chứa `<script>alert('xss')</script>` hoặc chuỗi SQL injection được lưu nguyên dạng text thuần (`body_text`), không thực thi và không gây lỗi truy vấn.
   - Kiểm tra bảng `audit_logs`: ghi nhận đầy đủ `GROUP_CREATE:success` và `ACCESS_DENIED:failure`, tuyệt đối không lưu mật khẩu, cookie hay token phiên trong `metadata_redacted`.