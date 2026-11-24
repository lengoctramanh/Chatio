# Task 6B — API chat nhóm và quản lý thành viên

Phạm vi: backend Express và PostgreSQL mở rộng trên nền Task 6A. Không chỉnh sửa xác thực/CSRF Task 5, không làm giao diện, Socket.IO, lịch sử tin nhắn, tìm kiếm hay đính kèm file.

## Tiền đề

- Kế thừa `requireAuth` và `requireCsrf` từ Task 5 (cookie phiên `chatio_sid` và header `X-CSRF-Token`).
- Các request `POST` bắt buộc có `Content-Type: application/json` (`requireJsonBody`) và giới hạn body **16 KB**.
- Người thực hiện luôn xác định từ phiên `req.user.id`; các trường giả mạo từ client như `ownerId`, `createdBy`, `senderId`, `memberRole` đều bị bỏ qua.
- Cấu trúc trả về lỗi thống nhất: `{ "error": { "code": "...", "message": "..." } }`.

## 1. POST /api/conversations/groups

Tạo cuộc trò chuyện nhóm mới. Người tạo tự động trở thành chủ nhóm (`memberRole: "owner"`), các thành viên được thêm ban đầu có vai trò `"member"`.

Yêu cầu: đăng nhập, CSRF, Content-Type JSON.

```json
{
  "name": "Nhóm Đồ Án",
  "memberIds": [
    "2fb6518a-74a9-4e42-8e12-63e95ae7dc19",
    "8d1d4b84-d917-49e7-925e-84caf3c67ca3"
  ]
}
```

- `memberIds` có thể là mảng rỗng `[]` (tạo nhóm chỉ có chủ nhóm) hoặc danh sách UUID của các thành viên khác.
- `201`: tạo nhóm thành công trong cùng transaction (`conversations` + `conversation_members`), ghi audit log `GROUP_CREATE` (`success`):
  ```json
  {
    "conversation": {
      "id": "...",
      "type": "group",
      "name": "Nhóm Đồ Án",
      "status": "active",
      "createdBy": "...",
      "createdAt": "...",
      "members": [
        { "userId": "...", "username": "owner", "memberRole": "owner" },
        { "userId": "...", "username": "bob", "memberRole": "member" }
      ]
    },
    "created": true
  }
  ```
- `400 VALIDATION_ERROR`: tên nhóm rỗng / chỉ chứa khoảng trắng / vượt giới hạn ký tự; `memberIds` không phải mảng; chứa UUID sai định dạng; chứa trùng ID; chứa chính ID người tạo; hoặc chứa tài khoản không tồn tại / đang bị khóa (`locked`).
- `401`: chưa đăng nhập hoặc phiên hết hạn.
- `403 CSRF_INVALID`: thiếu hoặc sai `X-CSRF-Token`.
- `415`: sai `Content-Type` (không phải `application/json`).
- `500 INTERNAL_ERROR`: lỗi CSDL trong transaction (tự động rollback toàn bộ, không để lại dữ liệu nhóm tạo dở).

## 2. GET /api/conversations & GET /api/conversations/:id (Mở rộng cho nhóm)

- **GET /api/conversations:** Trả về `{ "conversations": [ ... ] }` bao gồm cả hội thoại `direct` và `group` mà người dùng **còn đang tham gia** (`left_at IS NULL`). Nhóm mà người dùng đã bị xóa khỏi danh sách sẽ tự động ẩn.
- **GET /api/conversations/:id:** Trả về metadata `{ "conversation": ... }` của nhóm nếu người gọi đang là thành viên. Người ngoài nhóm (kể cả `admin` toàn hệ thống) nhận `403 FORBIDDEN`; ID không tồn tại nhận `404 CONVERSATION_NOT_FOUND`.

## 3. GET /api/conversations/:id/members

Xem danh sách thành viên hiện tại của nhóm (`left_at IS NULL`).

Yêu cầu: đăng nhập và đang là thành viên của nhóm (`owner` hoặc `member`).

- `200`: trả về danh sách thành viên đang hoạt động:
  ```json
  {
    "members": [
      { "userId": "...", "username": "owner", "memberRole": "owner", "joinedAt": "..." },
      { "userId": "...", "username": "bob", "memberRole": "member", "joinedAt": "..." }
    ]
  }
  ```
- `400 VALIDATION_ERROR`: `:id` không phải UUID hoặc hội thoại không phải loại `group`.
- `401`: chưa đăng nhập.
- `403 FORBIDDEN`: người gọi không phải thành viên nhóm (kể cả tài khoản `admin` hệ thống không tham gia nhóm).
- `404 CONVERSATION_NOT_FOUND`: nhóm không tồn tại.

## 4. POST /api/conversations/:id/members

Chủ nhóm (`owner`) thêm thành viên mới vào nhóm.

Yêu cầu: đăng nhập, CSRF, Content-Type JSON, và người gọi phải là **`owner`** của nhóm.

```json
{
  "userId": "2fb6518a-74a9-4e42-8e12-63e95ae7dc19"
}
```

- `201`: thêm thành viên thành công (tạo bản ghi mới với `joined_at` hiện tại, `left_at = NULL`), trả về danh sách thành viên cập nhật `{ "members": [ ... ] }` và ghi audit log.
  - *Trường hợp thêm lại (Rejoin):* Nếu người dùng từng bị xóa khỏi nhóm trước đó, hệ thống tạo một bản ghi thành viên mới với mốc `joined_at` mới; người này không có quyền đọc các tin nhắn phát sinh trong khoảng thời gian vắng mặt.
- `400 VALIDATION_ERROR`: `userId` sai định dạng UUID, tài khoản không tồn tại hoặc đang bị khóa (`locked`).
- `401`: chưa đăng nhập.
- `403 FORBIDDEN` / `CSRF_INVALID`: người gọi không phải chủ nhóm (`owner`) — bao gồm cả thành viên thường (`member`) và `admin` hệ thống — hoặc thiếu/sai CSRF token.
- `404 CONVERSATION_NOT_FOUND`: nhóm không tồn tại.
- `409`: người dùng hiện đã là thành viên đang hoạt động trong nhóm (chống thêm trùng kể cả khi gửi nhiều request đồng thời).

## 5. DELETE /api/conversations/:id/members/:userId

Chủ nhóm (`owner`) xóa thành viên khỏi nhóm bằng cách cập nhật mốc thời gian rời nhóm (`left_at = clock_timestamp()`).

Yêu cầu: đăng nhập, CSRF, và người gọi phải là **`owner`** của nhóm.

- `200`: xóa thành công, trả về danh sách thành viên còn lại `{ "members": [ ... ] }`. Ngay sau thời điểm `left_at`, người bị xóa mất quyền xem nhóm, xem thành viên và gửi tin nhắn vào nhóm.
- `400 VALIDATION_ERROR`: chủ nhóm tự xóa chính mình (`:userId` trùng với `owner`), hoặc UUID không hợp lệ.
- `401`: chưa đăng nhập.
- `403 FORBIDDEN` / `CSRF_INVALID`: người gọi không phải chủ nhóm (`owner`) hoặc thiếu/sai CSRF token.
- `404`: nhóm không tồn tại hoặc `:userId` không phải thành viên đang hoạt động trong nhóm.

## 6. Tích hợp gửi tin nhắn nhóm & Bảo mật

- **Endpoint:** `POST /api/conversations/:id/messages` (dùng chung với Task 6A) được kích hoạt quyền gửi nhóm thông qua callback tin cậy phía server `authorizeGroupSend`.
- **Khóa đồng thời (Concurrency):** Khi gửi tin, transaction khóa hàng `conversations` (`FOR UPDATE`) và hàng `conversation_members` (`FOR SHARE`) để đảm bảo nếu thành viên vừa bị xóa (`left_at` được cập nhật), request gửi tin chạy đồng thời sẽ bị từ chối với mã `403 FORBIDDEN`.
- **Giới hạn & Chống tấn công:** Áp dụng đầy đủ giới hạn **30 tin/60 giây** (`429 MESSAGE_RATE_LIMIT`), chống gửi trùng qua `clientMsgId` (`200` với `created: false` hoặc `409 CLIENT_MSG_ID_CONFLICT`), lưu nguyên bản văn bản thuần chống XSS/SQLi, và ghi nhận các lần từ chối truy cập vào `audit_logs` (`ACCESS_DENIED`) mà không làm lộ mật khẩu, token hay câu lệnh SQL.

## 7. Thay đổi file (Task 6B)

- **Migration:** `backend/database/migrations/1793620000000_group-chat-name.js` (bổ sung cột tên nhóm và ràng buộc thành viên).
- **Services:** `backend/src/services/groupConversations.js`, cập nhật `conversationPermissions.js` và `directConversations.js`.
- **Routes:** cập nhật `backend/src/routes/conversations.js` bổ sung các endpoint nhóm và thành viên.
- **Kiểm thử & Tài liệu:** `backend/tests/group-chat.test.js`, `docs/api/task6b-group-chat.md`, `docs/testing/task6b-run-and-test.md`.