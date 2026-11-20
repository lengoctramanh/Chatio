import { withTransaction } from '../db/pool.js';
import { ChatError, badInput, requireUuid } from './chatErrors.js';
import { assertCanSendMessage } from './conversationPermissions.js';

const MAX_CHARS = 4000;
const RATE_LIMIT = 30;

/** Giữ text nguyên dạng; frontend bắt buộc render bằng textContent, không innerHTML. */
export const validateTextMessage = ({ conversationId, clientMsgId, bodyText }) => {
  const id = requireUuid(conversationId, 'conversationId');
  const clientId = requireUuid(clientMsgId, 'clientMsgId');
  if (typeof bodyText !== 'string' || !bodyText.trim() || [...bodyText].length > MAX_CHARS) {
    throw badInput('bodyText phải là văn bản không rỗng, tối đa 4.000 ký tự');
  }
  return { conversationId: id, clientMsgId: clientId, bodyText };
};

const toMessage = (row) => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  clientMsgId: row.client_msg_id,
  bodyText: row.body_text,
  createdAt: row.created_at,
});

/**
 * Dịch vụ gửi CHUNG dành cho REST, và Task 6B/7 sau này.
 * senderId chỉ lấy từ ngữ cảnh phiên ĐÃ xác thực; không truyền trực tiếp req.body.
 * Giới hạn áp dụng ngay tại đây, không nằm ở router, nên mọi kênh đều bị giới hạn.
 * Transaction + khóa hàng users bảo đảm 30 tin / 60 giây cả khi request đồng thời.
 * Kết quả chỉ xuất hiện sau khi COMMIT thành công.
 */
export const sendTextMessage = async ({
  senderId,
  conversationId,
  clientMsgId,
  bodyText,
  authorizeGroupSend = null,
}) => {
  const sender = requireUuid(senderId, 'senderId');
  const input = validateTextMessage({ conversationId, clientMsgId, bodyText });
  return withTransaction(async (db) => {
    // Lock người gửi vừa chống race rate-limit vừa kiểm tra khóa tài khoản tức thì.
    const { rows: users } = await db.query(
      'SELECT id, status, must_change_password FROM users WHERE id = $1 FOR UPDATE',
      [sender]
    );
    if (!users.length || users[0].status !== 'active' || users[0].must_change_password) {
      throw new ChatError(403, 'SENDER_INACTIVE', 'Tài khoản chưa được phép gửi tin');
    }
    await assertCanSendMessage(db, input.conversationId, sender, { authorizeGroupSend });

    // Kiểm tra gửi lại TRƯỚC rate limit; chỉ trả tin cũ khi nội dung và hội thoại giống hệt.
    const { rows: existing } = await db.query(
      `SELECT id, conversation_id, sender_id, client_msg_id, body_text, created_at
         FROM messages WHERE sender_id = $1 AND client_msg_id = $2`,
      [sender, input.clientMsgId]
    );
    if (existing.length) {
      if (existing[0].conversation_id !== input.conversationId || existing[0].body_text !== input.bodyText) {
        throw new ChatError(409, 'CLIENT_MSG_ID_CONFLICT', 'clientMsgId đã được dùng cho một tin khác');
      }
      return { message: toMessage(existing[0]), created: false };
    }

    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*)::int AS total FROM messages
        WHERE sender_id = $1 AND created_at > clock_timestamp() - INTERVAL '60 seconds'`,
      [sender]
    );
    if (total >= RATE_LIMIT) {
      throw new ChatError(429, 'MESSAGE_RATE_LIMIT', 'Chỉ được gửi tối đa 30 tin trong 60 giây');
    }
    const { rows } = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, client_msg_id, body_text, created_at)
       VALUES ($1, $2, $3, $4, clock_timestamp())
       RETURNING id, conversation_id, sender_id, client_msg_id, body_text, created_at`,
      [input.conversationId, sender, input.clientMsgId, input.bodyText]
    );
    return { message: toMessage(rows[0]), created: true };
  });
};
