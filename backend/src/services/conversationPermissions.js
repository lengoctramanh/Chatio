import { ChatError, requireUuid } from './chatErrors.js';

/**
 * Quyền xem: kiểm tra thành viên còn hoạt động trong hội thoại đang mở.
 * Không có ngoại lệ cho global_role='admin'.
 * Gọi mỗi khi đọc metadata/hội thoại; task lịch sử/file có thể dùng lại.
 */
export const assertCanViewConversation = async (db, conversationId, userId) => {
  const id = requireUuid(conversationId, 'conversationId');
  const { rows } = await db.query(
    `SELECT c.id, c.type, c.status, c.created_by, c.created_at,
            m.id AS membership_id
       FROM conversations c
       LEFT JOIN conversation_members m
         ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
      WHERE c.id = $1`,
    [id, userId]
  );
  if (!rows.length) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy hội thoại');
  if (rows[0].status !== 'active' || !rows[0].membership_id) {
    throw new ChatError(403, 'FORBIDDEN', 'Không có quyền truy cập hội thoại');
  }
  return rows[0];
};

/**
 * Gọi trong transaction sau khi đã khóa user và conversation.
 * FOR SHARE trên hàng member chặn UPDATE left_at/DELETE đồng thời đến khi COMMIT tin.
 * B (chat nhóm) phải xóa/đánh dấu left_at bằng UPDATE/DELETE trên hàng này.
 */
export const assertActiveMemberForSend = async (db, conversationId, senderId) => {
  const { rows } = await db.query(
    `SELECT id, member_role
       FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
      FOR SHARE`,
    [conversationId, senderId]
  );
  if (!rows.length) throw new ChatError(403, 'FORBIDDEN', 'Không có quyền gửi vào hội thoại');
  return rows[0];
};

/**
 * Hàm quyền gửi chung. Hội thoại nhóm mặc định BỊ CHẶN cho đến khi Task 6B
 * truyền callback tin cậy authorizeGroupSend(db, {conversationId,senderId,member}).
 * Callback phải trả true; không bao giờ lấy callback từ request/socket payload.
 */
export const assertCanSendMessage = async (
  db, conversationId, senderId, { authorizeGroupSend = null } = {}
) => {
  const id = requireUuid(conversationId, 'conversationId');
  const { rows } = await db.query(
    'SELECT id, type, status FROM conversations WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!rows.length) throw new ChatError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy hội thoại');
  const conversation = rows[0];
  if (conversation.status !== 'active') {
    throw new ChatError(403, 'FORBIDDEN', 'Hội thoại không cho phép gửi tin');
  }
  // Trước khi tích hợp Task 6B, không cho phép gửi vào group dù người gửi là thành viên.
  if (conversation.type === 'group' && typeof authorizeGroupSend !== 'function') {
    throw new ChatError(403, 'GROUP_NOT_ENABLED', 'Chưa hỗ trợ gửi tin nhóm');
  }
  const member = await assertActiveMemberForSend(db, id, senderId);
  if (conversation.type === 'group') {
    if ((await authorizeGroupSend(db, { conversationId: id, senderId, member })) !== true) {
      throw new ChatError(403, 'FORBIDDEN', 'Không có quyền gửi tin nhóm');
    }
  } else if (conversation.type !== 'direct') {
    throw new ChatError(403, 'FORBIDDEN', 'Loại hội thoại không được hỗ trợ');
  }
  return conversation;
};
