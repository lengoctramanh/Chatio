# Task 6A — Hướng dẫn tích hợp và kiểm thử trên Windows (PowerShell)

## A. Lấy code nhóm mới nhất, không đụng branch cũ

> Nếu repo chưa có trên máy: `git clone https://github.com/lengoctramanh/Chatio.git` rồi `cd Chatio`.
> Nếu đã có repo: kiểm tra các thay đổi cá nhân qua `git status`; **commit/stash những thay đổi chưa lưu trước khi đổi branch**, không chạy `git reset --hard`.

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feature/direct-chat-messages
```

Giải nén bộ file Task 6A tải về. Chép các **file mới** vào đúng đường dẫn tương ứng trong repo. Với `backend/src/app.js`, không ghi đè file đồng đội nếu main đã thay đổi: chỉ thêm **2 dòng** dưới đây, giữ nguyên mọi dòng khác:

```diff
 import { authRouter } from './routes/auth.js';
+import { conversationsRouter } from './routes/conversations.js';
 // ...
 app.use('/api/admin', adminRouter);
+app.use('/api/conversations', conversationsRouter);
```

Cấu hình app cũ `express.json({ limit: '16kb' })` **giữ nguyên**. Không copy các phần không nằm trong Task 6A.

## B. Chạy database và migration

1. Mở Docker Desktop. Đặt `.env` trong thư mục gốc repo như hướng dẫn Task 5. Đảm bảo có `TEST_DATABASE_URL` trỏ tới DB **khác** với DB chính và có tên kết thúc `_test`, ví dụ `chatio_test`.
2. Trong thư mục gốc:

```powershell
docker compose up -d db
docker compose ps
cd backend
npm.cmd ci
# Migrations cần quyền tạo bảng và GRANT. Nhập URL của postgres/admin cho database chatio.
# Không dùng URL chatio_test; không lưu thông tin này vào repo hoặc commit.
$env:DATABASE_URL = Read-Host 'URL migration admin cho database chatio'
npm.cmd run db:migrate
Remove-Item Env:DATABASE_URL
```

`db:migrate` cần chạy bằng tài khoản có quyền tạo bảng/GRANT (thường là `postgres`), vì `.env.example` cấu hình `DATABASE_URL` cho role ít quyền `chatio_app` chỉ để chạy ứng dụng. Dòng `$env:DATABASE_URL` ở trên chỉ ghi đè tạm cho lệnh migrate; sau đó xóa ngay để server dùng lại `.env`. **URL migration phải chỉ đến database `chatio`, không phải `chatio_test`.** Các lệnh `npm test` dùng riêng `TEST_DATABASE_URL` qua `tests/helpers.js`.

Nếu thiếu DB test, tạo **một lần** trên DB server bằng quyền quản trị (`postgres`) trong DBeaver:

```sql
CREATE DATABASE chatio_test;
```

Mọi dữ liệu kiểm thử sẽ bị xóa trong `chatio_test`, không phải `chatio`. **Không đổi TEST_DATABASE_URL thành database thật**, không chạy `docker compose down -v` để tránh mất dữ liệu.

## C. Chạy test tự động

```powershell
# đang ở backend/
npm.cmd test
```

Kiểm tra kết quả cuối dòng `# fail 0`. Task 5 trước đó có **41 test**; bộ Task 6A thêm các test độc lập trong `direct-chat.test.js`. Đặc biệt kiểm tra:

- Tạo chat lần đầu; tạo lại theo thứ tự ngược; 12 yêu cầu đồng thời tạo đúng một chat.
- Lỗi giữa transaction không để lại hội thoại hoặc thành viên; lỗi INSERT tin không báo thành công.
- Người thứ ba/admin bị từ chối, cookie thiếu/hết hạn, tài khoản khóa và CSRF sai.
- `sender_id`/`role` giả không thay đổi người gửi; SQL injection và HTML/script được lưu như văn bản.
- Gửi lặp `clientMsgId` không tạo tin; dùng lại mã cho nội dung khác trả 409.
- Tin rỗng/quá dài/sai kiểu bị từ chối; tin 4.000 ký tự Unicode được nhận.
- Tin thứ 31 trong cửa sổ 60 giây trả 429; 34 request đồng thời chỉ 30 được lưu.
- Thành viên bị đánh dấu `left_at` trước khi gửi phải bị từ chối; chat nhóm bị chặn cho đến khi B tích hợp.

Nếu lỗi, gửi leader **thông báo lỗi không chứa mật khẩu/token** và đầu ra `npm test` sau khi che dữ liệu nhạy cảm.

## D. Thử tay API sau khi test đạt

Khởi động backend từ thư mục `backend`:

```powershell
npm.cmd run dev
```

Trong terminal PowerShell khác, đăng nhập **hai tài khoản active đã đổi mật khẩu lần đầu** (có thể nhờ admin tạo theo Task 5). Ví dụ bên dưới thay username/mật khẩu thật; không commit mật khẩu hoặc cookie:

```powershell
$base = 'http://localhost:3000'
$aliceSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$bobSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$a = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $aliceSession -ContentType 'application/json' -Body (@{username='alice'; password='NHAP_MAT_KHAU_ALICE'} | ConvertTo-Json)
$b = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $bobSession -ContentType 'application/json' -Body (@{username='bob'; password='NHAP_MAT_KHAU_BOB'} | ConvertTo-Json)

$conversationReq = @{peerUserId=$b.user.id} | ConvertTo-Json
$c = Invoke-RestMethod -Method Post -Uri "$base/api/conversations/direct" -WebSession $aliceSession -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$a.csrfToken} -Body $conversationReq
$c.conversation.id  # nhớ ID này

$body = @{conversationId=$c.conversation.id; clientMsgId=[guid]::NewGuid().ToString(); bodyText='Xin chào Bob!'} | ConvertTo-Json
$m = Invoke-RestMethod -Method Post -Uri "$base/api/conversations/$($c.conversation.id)/messages" -WebSession $aliceSession -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$a.csrfToken} -Body $body
$m.created      # True
$m.message.bodyText

# Gửi lại đúng mã và text: created phải False, message.id giống hệt
$retry = Invoke-RestMethod -Method Post -Uri "$base/api/conversations/$($c.conversation.id)/messages" -WebSession $aliceSession -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$a.csrfToken} -Body $body
$retry.created
$retry.message.id

# Xem danh sách của Alice/Bob
Invoke-RestMethod -Uri "$base/api/conversations" -WebSession $aliceSession
Invoke-RestMethod -Uri "$base/api/conversations" -WebSession $bobSession
```

Xác minh dữ liệu bằng DBeaver **database chính của môi trường dev** (không sửa/xóa dữ liệu):

```sql
SELECT id, type, created_by FROM conversations ORDER BY created_at DESC LIMIT 10;
SELECT conversation_id, user_low, user_high FROM direct_conversation_pairs;
SELECT conversation_id, sender_id, client_msg_id, body_text, created_at
  FROM messages ORDER BY created_at DESC LIMIT 10;
```

## E. Kiểm tra chỉ đúng phạm vi Task 6A

```powershell
git status --short
git diff -- backend/src/app.js
git diff --name-status
git diff --check
```

Lệnh `git diff --name-status` không hiển thị file chưa `git add`; xem thêm `git status --short` để kiểm tra. Không được có thay đổi ở `frontend/`, middleware Task 5 hoặc migration Task 4. Khi test đạt:

```powershell
git add backend/src/app.js backend/src/routes/conversations.js backend/src/services/chatErrors.js backend/src/services/conversationPermissions.js backend/src/services/directConversations.js backend/src/services/messageService.js backend/database/migrations/1793610000000_direct-chat-pairs.js backend/tests/direct-chat.test.js docs/api/task6a-direct-chat.md docs/testing/task6a-run-and-test.md
git diff --cached --stat
git commit -m "feat: add direct chat and shared message service"
git push -u origin feature/direct-chat-messages
```

Trên GitHub tạo **Pull Request từ `feature/direct-chat-messages` vào `main`**, gửi leader review và chạy lại toàn bộ test. **Không tự merge.**

## F. Các trường hợp đang chờ bạn B

- Quyền gửi chat nhóm phải được bạn B cung cấp callback và đồng ý thứ tự khóa transaction.
- Test tích hợp gửi đồng thời với xóa thành viên nhóm sẽ chạy sau khi phần nhóm có mặt.
- Chưa làm giao diện, Socket.IO, lịch sử, tìm kiếm, file theo giới hạn Task 6A.

**Lưu ý kiểm chứng:** Mã nguồn bổ sung được rà soát và kiểm tra cú pháp JavaScript. Chưa thể khẳng định tất cả test tự động đã đạt trên máy của bạn vì việc này cần Node dependencies và PostgreSQL thực chạy với `TEST_DATABASE_URL`.
