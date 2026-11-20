import { Router } from 'express';
import { pool } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { sendError } from '../lib/httpError.js';
import { requireAuth, requireCsrf } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/sameOrigin.js';
import { ChatError, badInput } from '../services/chatErrors.js';
import {
  getMyConversation, listMyConversations, openDirectConversation,
} from '../services/directConversations.js';
import { sendTextMessage } from '../services/messageService.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

const respondToChatError = async (error, req, res, action) => {
  if (error instanceof ChatError) {
    if (error.status === 403 || error.status === 404) {
      // Không log body, tên token, cookie hoặc đoạn text; tránh cả query string.
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
  // PostgreSQL có thể chứa dữ liệu trong error.detail: tuyệt đối không in error ra log.
  console.error(`Task 6A: ${action} failed`);
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

/** GET /api/conversations: chỉ chat riêng mình tham gia. */
conversationsRouter.get('/', async (req, res) => {
  try {
    return res.json({ conversations: await listMyConversations(req.user.id) });
  } catch (error) {
    return respondToChatError(error, req, res, 'list_conversations');
  }
});

/** GET /api/conversations/:id: metadata, CHƯA có lịch sử tin. */
conversationsRouter.get('/:id', async (req, res) => {
  try {
    const conversation = await getMyConversation(req.user.id, req.params.id);
    return res.json({ conversation });
  } catch (error) {
    return respondToChatError(error, req, res, 'view_conversation');
  }
});

/** POST /api/conversations/:id/messages, body {conversationId?,clientMsgId,bodyText}. */
conversationsRouter.post('/:id/messages', requireCsrf, requireJsonBody, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw badInput();
    // Giữ tương thích cả 2 cách client gửi ID; không cho hai ID bất nhất.
    if (req.body.conversationId !== undefined && req.body.conversationId !== req.params.id) {
      throw badInput('conversationId không trùng với ID trên đường dẫn');
    }
    const result = await sendTextMessage({
      senderId: req.user.id, // KHÔNG lấy senderId, sender_id, role từ body
      conversationId: req.params.id,
      clientMsgId: req.body.clientMsgId,
      bodyText: req.body.bodyText,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    return respondToChatError(error, req, res, 'send_text');
  }
});
