import { ChatError, requireUuid } from './chatErrors.js';

/**
 * Quyền xem metadata hội thoại: kiểm tra thành viên còn hoạt động trong hội thoại đang mở.
 * Không có ngoại lệ cho global_role='admin'.
 */
export const assertCanViewConversation = async (db, conversationId, userId) => {
  const id = requireUuid(conversationId, 'conversationId');
  const { rows } = await db.query(
    `SELECT c.id, c.type, c.name, c.status, c.created_by, c.created_at,
            m.id AS membership_id, m.member_role, m.joined_at
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
 * Quyền đọc tin nhắn/tìm kiếm/tải file dành cho Task 6B, Task 7 và Task 8.
 * - Người đã rời/bị xóa (left_at IS NOT NULL) hoặc người ngoài (kể cả admin) -> chặn.
 * - Với nhóm: chỉ được xem nội dung phát sinh từ thời điểm joined_at của lần tham gia hiện tại
 *   (không mở lại tin trong thời gian vắng mặt trước đó).
 * - Nếu truyền messageCreatedAt, kiểm tra trực tiếp tin nhắn cụ thể có nằm trong phạm vi được phép đọc không.
 */
export const assertCanReadConversationContent = async (
  db,
  conversationId,
  userId,
  { messageCreatedAt = null } = {}
) => {
  const conv = await assertCanViewConversation(db, conversationId, userId);
  const visibleFrom = conv.type === 'group' ? conv.joined_at : null;

  if (messageCreatedAt && visibleFrom) {
    const msgTime = new Date(messageCreatedAt).getTime();
    const joinTime = new Date(visibleFrom).getTime();
    if (Number.isNaN(msgTime) || msgTime < joinTime) {
      throw new ChatError(403, 'FORBIDDEN', 'Không có quyền xem nội dung trước thời điểm tham gia nhóm');
    }
  }

  return {
    conversation: conv,
    visibleFrom, // Task 7/8 dùng điều kiện: WHERE ($visibleFrom::timestamptz IS NULL OR created_at >= $visibleFrom)
  };
};

/**
 * Gọi trong transaction sau khi đã khóa user và conversation.
 * FOR SHARE trên hàng member chặn UPDATE left_at đồng thời đến khi COMMIT tin.
 */
export const assertActiveMemberForSend = async (db, conversationId, senderId) => {
  const { rows } = await db.query(
    `SELECT id, member_role, joined_at
       FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
      FOR SHARE`,
    [conversationId, senderId]
  );
  if (!rows.length) throw new ChatError(403, 'FORBIDDEN', 'Không có quyền gửi vào hội thoại');
  return rows[0];
};

/**
 * Callback phía server cho Task 6B: xác thực quyền gửi tin trong nhóm.
 * Đã được gọi sau khi khóa user (active) và khóa hàng member (left_at IS NULL FOR SHARE).
 */
export const authorizeGroupSend = async (db, { conversationId, senderId, member }) => {
  if (!member || !member.id) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
       JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = $1
        AND m.conversation_id = $2
        AND m.user_id = $3
        AND m.left_at IS NULL
        AND u.status = 'active'
        AND c.type = 'group'
        AND c.status = 'active'`,
    [member.id, conversationId, senderId]
  );
  return rows.length === 1;
};

/**
 * Hàm quyền gửi chung. Hội thoại nhóm mặc định BỊ CHẶN cho đến khi truyền callback authorizeGroupSend.
 */
export const assertCanSendMessage = async (
  db,
  conversationId,
  senderId,
  { authorizeGroupSend: groupAuthCallback = null } = {}
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
  if (conversation.type === 'group' && typeof groupAuthCallback !== 'function') {
    throw new ChatError(403, 'GROUP_NOT_ENABLED', 'Chưa hỗ trợ gửi tin nhóm');
  }
  const member = await assertActiveMemberForSend(db, id, senderId);
  if (conversation.type === 'group') {
    if ((await groupAuthCallback(db, { conversationId: id, senderId, member })) !== true) {
      throw new ChatError(403, 'FORBIDDEN', 'Không có quyền gửi tin nhóm');
    }
  } else if (conversation.type !== 'direct') {
    throw new ChatError(403, 'FORBIDDEN', 'Loại hội thoại không được hỗ trợ');
  }
  return conversation;
};