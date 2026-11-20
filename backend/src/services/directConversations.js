import { pool, withTransaction } from '../db/pool.js';
import { ChatError, requireUuid } from './chatErrors.js';
import { assertCanViewConversation } from './conversationPermissions.js';

const publicConversation = (row) => ({
  id: row.id,
  type: row.type,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  members: row.members ?? [],
});

const membersFor = async (db, id) => {
  const { rows } = await db.query(
    `SELECT m.user_id AS "userId", u.username, m.member_role AS "memberRole"
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1 AND m.left_at IS NULL
      ORDER BY u.username`,
    [id]
  );
  return rows;
};

/** Hai yêu cầu cùng cặp bị tuần tự hóa nhờ row lock và advisory lock; UNIQUE là bảo vệ cuối. */
export const openDirectConversation = async (creatorUserId, peerUserId) => {
  const creator = requireUuid(creatorUserId, 'userId');
  const peer = requireUuid(peerUserId, 'peerUserId');
  if (creator === peer) throw new ChatError(400, 'VALIDATION_ERROR', 'Không thể chat riêng với chính mình');
  const [low, high] = [creator, peer].sort();

  return withTransaction(async (db) => {
    // Lock hai user theo thứ tự ổn định; kiểm tra tài khoản ngay lúc tạo.
    const { rows: users } = await db.query(
      'SELECT id, status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[low, high]]
    );
    if (users.length !== 2 || users.some((user) => user.status !== 'active')) {
      throw new ChatError(404, 'PEER_NOT_AVAILABLE', 'Tài khoản nhận không tồn tại hoặc không hoạt động');
    }
    // Khóa transaction theo cặp; hoạt động qua nhiều process/node server.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`direct:${low}:${high}`]);
    const { rows: old } = await db.query(
      `SELECT c.id, c.type, c.status, c.created_by, c.created_at
         FROM direct_conversation_pairs p JOIN conversations c ON c.id = p.conversation_id
        WHERE p.user_low = $1 AND p.user_high = $2`,
      [low, high]
    );
    if (old.length) {
      if (old[0].status !== 'active') {
        throw new ChatError(409, 'CONVERSATION_CLOSED', 'Hội thoại đã đóng');
      }
      return { conversation: publicConversation({ ...old[0], members: await membersFor(db, old[0].id) }), created: false };
    }
    const { rows: created } = await db.query(
      `INSERT INTO conversations (type, status, created_by)
       VALUES ('direct', 'active', $1)
       RETURNING id, type, status, created_by, created_at`,
      [creator]
    );
    const conversationId = created[0].id;
    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, member_role)
       VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
      [conversationId, creator, peer]
    );
    await db.query(
      `INSERT INTO direct_conversation_pairs (conversation_id, user_low, user_high)
       VALUES ($1, $2, $3)`,
      [conversationId, low, high]
    );
    return {
      conversation: publicConversation({ ...created[0], members: await membersFor(db, conversationId) }),
      created: true,
    };
  });
};

/** Hiện chỉ trả chat riêng; giữ shape {conversations:[...]} để Task 6B thêm type=group. */
export const listMyConversations = async (userId) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.type, c.status, c.created_by, c.created_at,
       COALESCE(json_agg(json_build_object(
         'userId', peer.user_id, 'username', u.username, 'memberRole', peer.member_role
       ) ORDER BY u.username), '[]'::json) AS members
       FROM conversations c
       JOIN conversation_members mine ON mine.conversation_id = c.id
          AND mine.user_id = $1 AND mine.left_at IS NULL
       JOIN conversation_members peer ON peer.conversation_id = c.id AND peer.left_at IS NULL
       JOIN users u ON u.id = peer.user_id
      WHERE c.type = 'direct' AND c.status = 'active'
      GROUP BY c.id
      ORDER BY c.created_at DESC`,
    [userId]
  );
  return rows.map(publicConversation);
};

/** Metadata một chat; không bao gồm lịch sử hoặc nội dung tin. */
export const getMyConversation = async (userId, conversationId) => {
  const row = await assertCanViewConversation(pool, conversationId, userId);
  return publicConversation({ ...row, members: await membersFor(pool, row.id) });
};
