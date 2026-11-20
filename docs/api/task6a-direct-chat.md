# Task 6A — API chat riêng và dịch vụ gửi tin dùng chung

Phạm vi: backend Express và PostgreSQL. Không chỉnh sửa xác thực/CSRF Task 5, không làm giao diện, Socket.IO, lịch sử tin, tìm kiếm hay file.

## Tiền đề

- `requireAuth` và `requireCsrf` từ Task 5, phiên cookie `chatio_sid` và header `X-CSRF-Token`.
- Mọi POST chỉ nhận `Content-Type: application/json` (dùng `requireJsonBody` cũ).
- Body JSON giới hạn **16 KB** như cấu hình Task 5. Tin nhắn có tối đa 4.000 ký tự Unicode.
- Người gửi luôn là `req.user.id`; `sender_id`, `senderId`, `role` từ client bị bỏ qua.
- Lỗi dùng chuẩn Task 5: `{ "error": { "code": "...", "message": "..." } }`.

## 1. POST /api/conversations/direct

Yêu cầu: đăng nhập, CSRF, Content-Type JSON.

```json
{ "peerUserId": "2fb6518a-74a9-4e42-8e12-63e95ae7dc19" }
```

- `201`: tạo thành công `{ "conversation": {"id":"...","type":"direct","status":"active","createdBy":"...","createdAt":"...","members":[{"userId":"...","username":"alice","memberRole":"member"}]}, "created":true }`. `members` sẽ có **đúng 2** người khi vừa tạo.
- `200`: cặp đã tồn tại: cùng shape, `created:false`, không tạo bản sao.
- `400 VALIDATION_ERROR`: UUID sai, tự chat với mình.
- `404 PEER_NOT_AVAILABLE`: tài khoản nhận không tồn tại / không hoạt động.
- `401`: không có phiên hợp lệ; `403 CSRF_INVALID`: thiếu/sai CSRF; `415`: body không phải JSON.
- `409 CONVERSATION_CLOSED`: cặp đã có hội thoại nhưng bị đóng; không tự tạo chat trùng.

Hàm dùng chung: `openDirectConversation(creatorUserId, peerUserId)` tại `backend/src/services/directConversations.js`. Transaction tạo `conversations`, hai `conversation_members`, `direct_conversation_pairs` cùng lúc. PostgreSQL advisory lock theo cặp và `UNIQUE(user_low,user_high)` chống tạo đồng thời. Migration cấp đúng quyền PostgreSQL cần dùng `SELECT ... FOR UPDATE/FOR SHARE` cho role `chatio_app` nếu role này tồn tại.

## 2. GET /api/conversations

Yêu cầu: đăng nhập. Trả `{ "conversations": [ ... ] }`, mỗi phần tử có các trường `id`, `type`, `status`, `createdBy`, `createdAt`, `members` giống API trên. **Hiện chỉ liệt kê chat riêng mà tài khoản còn là thành viên.** Task 6B thống nhất mở rộng cùng cấu trúc cho `type:"group"`. Không trả hội thoại của người khác.

## 3. GET /api/conversations/:id

Yêu cầu: đăng nhập. Chỉ trả **metadata** `{ "conversation": ... }` nếu còn là thành viên. Đây là API tối thiểu để kiểm tra quyền xem, **không phải lịch sử tin nhắn**. Người ngoài (kể cả admin) nhận `403 FORBIDDEN`, ID không tồn tại nhận `404 CONVERSATION_NOT_FOUND`.

## 4. POST /api/conversations/:id/messages

Yêu cầu: đăng nhập, CSRF, Content-Type JSON.

```json
{
  "conversationId": "ID-UUID-cua-hoi-thoai",
  "clientMsgId": "8d1d4b84-d917-49e7-925e-84caf3c67ca3",
  "bodyText": "Xin chào!"
}
```

- `conversationId` trong JSON có thể lược bỏ do đã có ID trên URL; nếu có **phải trùng** với URL.
- `201`: `{ "message": {"id":"...","conversationId":"...","senderId":"...","clientMsgId":"...","bodyText":"Xin chào!","createdAt":"..."}, "created":true }` **sau COMMIT**.
- `200`: gửi lại cùng `clientMsgId`, cùng tài khoản, cùng hội thoại và cùng text; `created:false`, không tăng quota.
- `409 CLIENT_MSG_ID_CONFLICT`: tái sử dụng mã cho text/hội thoại khác.
- `400 VALIDATION_ERROR`: dữ liệu không đúng kiểu; ID không phải UUID; text rỗng/toàn khoảng trắng/hơn 4.000 ký tự.
- `401`: phiên không hợp lệ. `403 FORBIDDEN`: không còn là thành viên. `403 GROUP_NOT_ENABLED`: chưa tích hợp quyền gửi nhóm. `429 MESSAGE_RATE_LIMIT`: vượt **30 tin trong cửa sổ trượt 60 giây** của người gửi.
- `500 INTERNAL_ERROR`: lưu PostgreSQL thất bại; không báo thành công, không lộ SQL.

CSDL tạo timestamp bằng `clock_timestamp()`. `messages(sender_id, client_msg_id)` đã có ràng buộc UNIQUE từ Task 4. Dịch vụ khóa user cho mỗi lần gửi để đồng bộ quota giữa REST và Socket.IO sau này. Không đặt limiter chỉ ở route.

**Văn bản và XSS:** lưu `bodyText` nguyên dạng trong PostgreSQL TEXT và trả nguyên trong JSON. Frontend **phải hiển thị qua `textContent` / React `{message.bodyText}`**, không dùng `innerHTML` / `dangerouslySetInnerHTML` cho nội dung tin. Chuỗi `<script>` là dữ liệu text, không được thực thi.

## 5. Giao diện dịch vụ để trao đổi với bạn B và Task 7

```js
import { sendTextMessage } from '../services/messageService.js';
import {
  assertCanViewConversation,
  assertCanSendMessage,
} from '../services/conversationPermissions.js';

// senderId đến từ phiên đã xác thực (REST: req.user.id, Socket.IO: verified session.user.id).
const result = await sendTextMessage({
  senderId: authenticatedUser.id,
  conversationId,
  clientMsgId,
  bodyText,
});
```

- Mặc định `type='group'` bị từ chối. Khi bạn B cung cấp hàm **tin cậy từ server** `authorizeGroupSend(db, {conversationId,senderId,member})`, có thể truyền callback đó vào dịch vụ. **Không lấy callback, vai trò hoặc senderId từ payload client.**
- Callback phải chạy **bên trong cùng transaction**; `assertCanSendMessage` đã khóa hàng conversation (`FOR UPDATE`) và hàng `conversation_members` (`FOR SHARE`) trước khi INSERT. Lệnh xóa thành viên của B phải UPDATE `left_at` hoặc DELETE trên hàng `conversation_members` tương ứng để không có race gửi tin sau khi bị xóa.
- Với API liệt kê, bạn B thêm `group` vào cùng mảng `conversations`, giữ cùng các trường đã thống nhất. Chưa thực hiện thay đổi code của B.

**Chưa xác nhận thỏa thuận với B:** file này là giao diện **đề xuất cần gửi bạn B/leader xem và chốt trước khi merge**; không tự nhận đã phối hợp xong.

## 6. Quyền và nhật ký

- `assertCanViewConversation(db, id, userId)` kiểm tra tư cách thành viên khi xem; không có quyền admin vượt trội.
- `assertCanSendMessage(db, id, senderId, options)` kiểm tra tư cách thành viên trong transaction ngay trước lưu.
- Khi bị cấm xem/gửi, route ghi `ACCESS_DENIED` qua `writeAudit` của Task 5, chỉ có `action` và mã lý do; không ghi nội dung tin, cookie, token hay SQL.
- Mọi truy vấn có đầu vào của client đều dùng `$1,$2...`, không ghép chuỗi SQL.

## 7. Thay đổi file (chỉ Task 6A)

- **Thêm mới:** `backend/database/migrations/1793610000000_direct-chat-pairs.js`.
- **Thêm mới:** `backend/src/services/chatErrors.js`, `conversationPermissions.js`, `directConversations.js`, `messageService.js`.
- **Thêm mới:** `backend/src/routes/conversations.js`.
- **Thêm mới:** `backend/tests/direct-chat.test.js` và tài liệu Task 6A.
- **Sửa đúng 2 dòng:** `backend/src/app.js` — import router và `app.use('/api/conversations', conversationsRouter)`.

Không sửa migration Task 4, `requireAuth`, `requireCsrf`, `pool`, auth/admin routes, `tests/helpers.js`, cấu hình giới hạn request 16 KB, frontend hay Socket.IO.
