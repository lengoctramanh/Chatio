import { Router } from 'express';
import { writeAudit } from '../lib/audit.js';
import { sendError } from '../lib/httpError.js';
import { requireAuth, requireCsrf } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/sameOrigin.js';
import { ChatError, badInput } from '../services/chatErrors.js';
import { authorizeGroupSend } from '../services/conversationPermissions.js';
import {
  getMyConversation,
  listMyConversations,
  openDirectConversation,
} from '../services/directConversations.js';
import {
  addGroupMember,
  createGroupConversation,
  listGroupMembers,
  removeGroupMember,
} from '../services/groupConversations.js';
import { sendTextMessage } from '../services/messageService.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

const respondToChatError = async (error, req, res, action) => {
  if (error instanceof ChatError) {
    if (error.status === 403 || error.status === 404) {
      await writeAudit({
        actorUserId: req.user.id,
        eventType: 'ACCESS_DENIED',
        outcome: 'failure',
        ip: req.ip,
        metadata: { action, reason: error.code },
      });
    }
    if (error.status === 429) res.set('Retry-After', '60');
    return sendError(res, error.status, error.code, error.message);
  }
  console.error(`Conversation error [${action}]`);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Không thể hoàn tất yêu cầu');
};

/** POST /api/conversations/direct, body {peerUserId}. */
conversationsRouter.post('/direct', requireCsrf, requireJsonBody, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw badInput();
    }
    const result = await openDirectConversation(req.user.id, req.body.peerUserId);
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'open_direct');
  }
});

/** POST /api/conversations/groups, body { name, memberIds }. */
conversationsRouter.post('/groups', requireCsrf, requireJsonBody, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw badInput();
    }
    const result = await createGroupConversation(
      req.user.id,
      {
        name: req.body.name,
        memberIds: req.body.memberIds ?? [],
      },
      req.ip
    );
    return res.status(201).json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'create_group');
  }
});

/** GET /api/conversations: danh sách chat riêng và nhóm mình còn là thành viên. */
conversationsRouter.get('/', async (req, res) => {
  try {
    return res.json({ conversations: await listMyConversations(req.user.id) });
  } catch (error) {
    return respondToChatError(error, req, res, 'list_conversations');
  }
});

/** GET /api/conversations/:id: metadata hội thoại (riêng hoặc nhóm). */
conversationsRouter.get('/:id', async (req, res) => {
  try {
    const conversation = await getMyConversation(req.user.id, req.params.id);
    return res.json({ conversation });
  } catch (error) {
    return respondToChatError(error, req, res, 'view_conversation');
  }
});

/** GET /api/conversations/:id/members: xem danh sách thành viên nhóm. */
conversationsRouter.get('/:id/members', async (req, res) => {
  try {
    const result = await listGroupMembers(req.user.id, req.params.id);
    return res.json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'list_group_members');
  }
});

/** POST /api/conversations/:id/members, body { userId }: chủ nhóm thêm thành viên. */
conversationsRouter.post('/:id/members', requireCsrf, requireJsonBody, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw badInput();
    }
    const result = await addGroupMember(req.user.id, req.params.id, req.body.userId, req.ip);
    return res.status(201).json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'add_group_member');
  }
});

/** DELETE /api/conversations/:id/members/:userId: chủ nhóm xóa thành viên (cập nhật left_at). */
conversationsRouter.delete('/:id/members/:userId', requireCsrf, async (req, res) => {
  try {
    const result = await removeGroupMember(req.user.id, req.params.id, req.params.userId, req.ip);
    return res.json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'remove_group_member');
  }
});

/** POST /api/conversations/:id/messages, body {conversationId?,clientMsgId,bodyText}. */
conversationsRouter.post('/:id/messages', requireCsrf, requireJsonBody, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw badInput();
    if (req.body.conversationId !== undefined && req.body.conversationId !== req.params.id) {
      throw badInput('conversationId không trùng với ID trên đường dẫn');
    }
    const result = await sendTextMessage({
      senderId: req.user.id,
      conversationId: req.params.id,
      clientMsgId: req.body.clientMsgId,
      bodyText: req.body.bodyText,
      authorizeGroupSend,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'send_text');
  }
});