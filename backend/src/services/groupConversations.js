import { pool, withTransaction } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { ChatError, badInput, requireUuid } from './chatErrors.js';
import { assertCanViewConversation } from './conversationPermissions.js';

const MAX_GROUP_NAME = 100;
const MAX_INITIAL_MEMBERS = 50;

const validateGroupName = (name) => {
  if (typeof name !== 'string') throw badInput('Tên nhóm phải là chuỗi ký tự');
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > MAX_GROUP_NAME) {
    throw badInput('Tên nhóm không được rỗng và tối đa 100 ký tự');
  }
  return trimmed;
};

const activeMembersFor = async (db, conversationId) => {
  const { rows } = await db.query(
    `SELECT m.user_id AS "userId", u.username, m.member_role AS "memberRole", m.joined_at AS "joinedAt"
       FROM conversation_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = $1 AND m.left_at IS NULL
      ORDER BY CASE WHEN m.member_role = 'owner' THEN 0 ELSE 1 END, u.username ASC`,
    [conversationId]
  );
  return rows;
};

const publicGroupConversation = (row, members) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at,
  members,
});

/**
 * Tạo nhóm mới: người tạo là member_role = 'owner'.
 */
export const createGroupConversation = async (creatorUserId, { name, memberIds = [] }, ip = null) => {
  const creatorId = requireUuid(creatorUserId, 'creatorUserId');
  const groupName = validateGroupName(name);

  if (!Array.isArray(memberIds)) {
    throw badInput('Danh sách thành viên phải là một mảng');
  }
  if (memberIds.length > MAX_INITIAL_MEMBERS) {
    throw badInput(`Chỉ được thêm tối đa ${MAX_INITIAL_MEMBERS} thành viên khi tạo nhóm`);
  }

  const normalizedIds = memberIds.map((id) => requireUuid(id, 'memberId'));
  const uniqueMemberSet = new Set(normalizedIds);
  if (uniqueMemberSet.size !== normalizedIds.length) {
    throw badInput('Danh sách thành viên không được chứa ID trùng lặp');
  }
  if (uniqueMemberSet.has(creatorId)) {
    throw badInput('Không cần truyền ID của chính người tạo vào danh sách thành viên thêm mới');
  }

  const allUserIds = [creatorId, ...normalizedIds].sort();

  return withTransaction(async (db) => {
    const { rows: users } = await db.query(
      'SELECT id, status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [allUserIds]
    );

    if (users.length !== allUserIds.length || users.some((u) => u.status !== 'active')) {
      throw new ChatError(400, 'INVALID_MEMBER', 'Một hoặc nhiều tài khoản không tồn tại hoặc không hoạt động');
    }

    const { rows: createdRows } = await db.query(
      `INSERT INTO conversations (type, name, status, created_by)
       VALUES ('group', $1, 'active', $2)
       RETURNING id, type, name, status, created_by, created_at`,
      [groupName, creatorId]
    );
    const group = createdRows[0];

    await db.query(
      `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
       VALUES ($1, $2, 'owner', clock_timestamp())`,
      [group.id, creatorId]
    );

    for (const memberId of normalizedIds) {
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
         VALUES ($1, $2, 'member', clock_timestamp())`,
        [group.id, memberId]
      );
    }

    await writeAudit(
      {
        actorUserId: creatorId,
        eventType: 'GROUP_CREATE',
        outcome: 'success',
        ip,
        metadata: { conversationId: group.id, memberCount: allUserIds.length },
      },
      db
    );

    const members = await activeMembersFor(db, group.id);
    return { conversation: publicGroupConversation(group, members) };
  });
};

/**
 * Xem danh sách thành viên đang hoạt động của nhóm.
 */
export const listGroupMembers = async (requesterId, conversationId) => {
  const userId = requireUuid(requesterId, 'userId');
  const conv = await assertCanViewConversation(pool, conversationId, userId);
  if (conv.type !== 'group') {
    throw badInput('Hội thoại này không phải là nhóm');
  }
  const members = await activeMembersFor(pool, conv.id);
  return { members };
};

const lockGroupAsOwner = async (db, conversationId, actorUserId) => {
  const { rows: convRows } = await db.query(
    'SELECT id, type, status FROM conversations WHERE id = $1 FOR UPDATE',
    [conversationId]
  );
  if (!convRows.length) {
    throw new ChatError(404, 'CONVERSATION_NOT_FOUND', 'Không tìm thấy nhóm');
  }
  const conv = convRows[0];
  if (conv.type !== 'group') {
    throw badInput('Thao tác chỉ áp dụng cho hội thoại nhóm');
  }
  if (conv.status !== 'active') {
    throw new ChatError(403, 'FORBIDDEN', 'Nhóm đã đóng');
  }

  const { rows: ownerRows } = await db.query(
    `SELECT id, member_role
       FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
      FOR UPDATE`,
    [conversationId, actorUserId]
  );
  if (!ownerRows.length || ownerRows[0].member_role !== 'owner') {
    throw new ChatError(403, 'FORBIDDEN', 'Chỉ chủ nhóm hiện tại mới có quyền quản lý thành viên');
  }
  return conv;
};

/**
 * Chủ nhóm thêm thành viên mới (hoặc thêm lại người từng rời nhóm).
 */
export const addGroupMember = async (actorUserId, conversationId, targetUserId, ip = null) => {
  const actorId = requireUuid(actorUserId, 'actorUserId');
  const groupId = requireUuid(conversationId, 'conversationId');
  const targetId = requireUuid(targetUserId, 'userId');

  return withTransaction(async (db) => {
    await lockGroupAsOwner(db, groupId, actorId);

    const { rows: targetUsers } = await db.query(
      'SELECT id, username, status FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    );
    if (!targetUsers.length || targetUsers[0].status !== 'active') {
      throw new ChatError(404, 'USER_NOT_AVAILABLE', 'Tài khoản không tồn tại hoặc không hoạt động');
    }

    const { rows: activeRows } = await db.query(
      `SELECT id FROM conversation_members
        WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [groupId, targetId]
    );
    if (activeRows.length > 0) {
      throw new ChatError(409, 'ALREADY_MEMBER', 'Tài khoản này đã là thành viên đang hoạt động trong nhóm');
    }

    try {
      await db.query(
        `INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
         VALUES ($1, $2, 'member', clock_timestamp())`,
        [groupId, targetId]
      );
    } catch (err) {
      if (err.code === '23505') {
        throw new ChatError(409, 'ALREADY_MEMBER', 'Tài khoản này đã là thành viên đang hoạt động trong nhóm');
      }
      throw err;
    }

    await writeAudit(
      {
        actorUserId: actorId,
        eventType: 'GROUP_MEMBER_ADD',
        outcome: 'success',
        ip,
        metadata: { conversationId: groupId, targetUserId: targetId },
      },
      db
    );

    const members = await activeMembersFor(db, groupId);
    return { members };
  });
};

/**
 * Chủ nhóm xóa thành viên khỏi nhóm (cập nhật left_at).
 */
export const removeGroupMember = async (actorUserId, conversationId, targetUserId, ip = null) => {
  const actorId = requireUuid(actorUserId, 'actorUserId');
  const groupId = requireUuid(conversationId, 'conversationId');
  const targetId = requireUuid(targetUserId, 'userId');

  return withTransaction(async (db) => {
    await lockGroupAsOwner(db, groupId, actorId);

    if (actorId === targetId) {
      throw new ChatError(400, 'CANNOT_REMOVE_OWNER', 'Không thể xóa chủ nhóm khỏi nhóm');
    }

    const { rows: targetMemberRows } = await db.query(
      `SELECT id, member_role
         FROM conversation_members
        WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
        FOR UPDATE`,
      [groupId, targetId]
    );

    if (!targetMemberRows.length) {
      throw new ChatError(404, 'MEMBER_NOT_FOUND', 'Thành viên không có trong nhóm hoặc đã rời nhóm');
    }

    if (targetMemberRows[0].member_role === 'owner') {
      throw new ChatError(400, 'CANNOT_REMOVE_OWNER', 'Không thể xóa chủ nhóm khỏi nhóm');
    }

    await db.query(
      `UPDATE conversation_members
          SET left_at = clock_timestamp()
        WHERE id = $1`,
      [targetMemberRows[0].id]
    );

    await writeAudit(
      {
        actorUserId: actorId,
        eventType: 'GROUP_MEMBER_REMOVE',
        outcome: 'success',
        ip,
        metadata: { conversationId: groupId, targetUserId: targetId },
      },
      db
    );

    const members = await activeMembersFor(db, groupId);
    return { members };
  });
};