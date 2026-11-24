# Task 6B — API chat nhóm, quản lý thành viên và tích hợp gửi tin

Phạm vi: backend Express và PostgreSQL. Tích hợp với dịch vụ dùng chung từ Task 6A (`messageService.js`, `conversationPermissions.js`), không chỉnh sửa xác thực/CSRF Task 5, không làm giao diện, Socket.IO, lịch sử tin nhắn, tìm kiếm hay file.

## Tiền đề

- `requireAuth` và `requireCsrf` từ Task 5, phiên cookie `chatio_sid` và header `X-CSRF-Token`.
- Mọi POST/DELETE nhận body chỉ chấp nhận `Content-Type: application/json` (`requireJsonBody`).
- Body JSON giới hạn **16 KB**. Tên nhóm có độ dài từ **1 đến 100 ký tự** (sau khi `trim()`).
- Người thực hiện luôn xác định từ `req.user.id`; mọi trường `createdBy`, `senderId`, `role` từ client đều bị bỏ qua.
- Lỗi dùng chuẩn Task 5: `{ "error": { "code": "...", "message": "..." } }`.

## 1. POST /api/conversations/group

Yêu cầu: đăng nhập, CSRF, `Content-Type: application/json`.

```json
{
  "name": "Nhóm dự án Chatio",
  "memberIds": [
    "2fb6518a-74a9-4e42-8e12-63e95ae7dc19",
    "9a31c710-1b84-49d0-a712-44e01c8b9910"
  ]
}