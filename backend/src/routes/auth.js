import { Router } from 'express';
import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { csrfTokenFor, isValidCsrfToken } from '../lib/csrf.js';
import { sendError } from '../lib/httpError.js';
import { recordFailure, recordSuccess, retryAfterSeconds } from '../lib/loginLimiter.js';
import {
  hashPassword,
  validateNewPassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../lib/passwords.js';
import {
  clearSessionCookie,
  createSession,
  findActiveSession,
  revokeAllUserSessions,
  revokeSession,
  sessionCookieOptions,
} from '../lib/sessions.js';
import { requireAuth, requireCsrf, requireRole, requireSession } from '../middleware/auth.js';
import {
  ROLES,
  USERNAME_PATTERN,
  createUser,
  findUserById,
  findUserByIdWithHash,
  findUserByUsernameWithHash,
  toPublicUser,
  updatePasswordHash,
} from '../models/user.js';

export const authRouter = Router();

const INVALID_LOGIN_MESSAGE = 'Thông tin đăng nhập không chính xác';

/**
 * POST /api/auth/register — quản trị viên tạo tài khoản (ACC-01).
 * Không có đăng ký công khai: yêu cầu phiên admin + CSRF.
 */
authRouter.post('/register', requireAuth, requireRole('admin'), requireCsrf, async (req, res) => {
  const { username, password, role = 'user' } = req.body ?? {};

  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return sendError(
      res,
      400,
      'VALIDATION_ERROR',
      'Username dài 3–50 ký tự, chỉ gồm chữ, số và . _ -'
    );
  }
  const passwordError = validateNewPassword(password);
  if (passwordError) return sendError(res, 400, 'VALIDATION_ERROR', passwordError);
  if (!ROLES.includes(role)) return sendError(res, 400, 'VALIDATION_ERROR', 'Vai trò không hợp lệ');

  try {
    const user = await createUser({ username, passwordHash: await hashPassword(password), role });
    await writeAudit({
      actorUserId: req.user.id,
      eventType: 'ACCOUNT_CREATE',
      outcome: 'success',
      ip: req.ip,
      metadata: { targetUserId: user.id, targetUsername: user.username, role: user.role },
    });
    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') {
      return sendError(res, 409, 'USERNAME_TAKEN', 'Username đã tồn tại');
    }
    throw error;
  }
});

/** POST /api/auth/login — đăng nhập bằng username + password, tạo phiên trong CSDL. */
authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const ip = req.ip;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Vui lòng nhập username và mật khẩu');
  }
  if (username.length > 50 || password.length > config.password.maxLength) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }

  const wait = retryAfterSeconds(username, ip);
  if (wait > 0) {
    await writeAudit({
      eventType: 'LOGIN',
      outcome: 'failure',
      ip,
      metadata: { reason: 'rate_limited', username },
    });
    res.set('Retry-After', String(wait));
    return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Bạn đã thử quá nhiều lần, vui lòng thử lại sau');
  }

  const row = await findUserByUsernameWithHash(username);
  const passwordOk = row
    ? await verifyPassword(row.password_hash, password)
    : await verifyAgainstDummy(password);

  if (!row || !passwordOk || row.status !== 'active') {
    recordFailure(username, ip);
    await writeAudit({
      actorUserId: row?.id ?? null,
      eventType: 'LOGIN',
      outcome: 'failure',
      ip,
      metadata: {
        reason: !row ? 'unknown_user' : !passwordOk ? 'wrong_password' : `account_${row.status}`,
        username,
      },
    });
    // Cùng một thông báo cho mọi trường hợp để không lộ tài khoản có tồn tại hay bị khóa.
    return sendError(res, 401, 'INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }

  recordSuccess(username);
  const session = await createSession(row.id);
  await writeAudit({ actorUserId: row.id, eventType: 'LOGIN', outcome: 'success', ip });

  res.cookie(config.session.cookieName, session.token, sessionCookieOptions());
  return res.json({
    user: toPublicUser(row),
    csrfToken: csrfTokenFor(session.sessionId),
    expiresAt: session.expiresAt,
  });
});

/**
 * POST /api/auth/logout — thu hồi phiên hiện tại và xóa cookie.
 * Phiên không tồn tại/hết hạn: chỉ xóa cookie, trả 204.
 * Phiên hợp lệ nhưng sai CSRF: 403, không thu hồi.
 */
authRouter.post('/logout', async (req, res) => {
  const session = await findActiveSession(req.cookies?.[config.session.cookieName]);
  if (!session) {
    clearSessionCookie(res);
    return res.status(204).end();
  }
  if (!isValidCsrfToken(session.sessionId, req.get('x-csrf-token'))) {
    return sendError(res, 403, 'CSRF_INVALID', 'CSRF token không hợp lệ');
  }

  await revokeSession(session.sessionId);
  await writeAudit({ actorUserId: session.user.id, eventType: 'LOGOUT', outcome: 'success', ip: req.ip });
  clearSessionCookie(res);
  return res.status(204).end();
});

/** GET /api/auth/me — thông tin người đang đăng nhập và CSRF token của phiên. */
authRouter.get('/me', requireSession, async (req, res) => {
  const user = await findUserById(req.user.id);
  return res.json({ user, csrfToken: csrfTokenFor(req.sessionId) });
});

/**
 * POST /api/auth/change-password — đổi mật khẩu, thu hồi mọi phiên, yêu cầu đăng nhập lại.
 * Cho phép cả tài khoản đang bị buộc đổi mật khẩu lần đầu.
 */
authRouter.post('/change-password', requireSession, requireCsrf, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  const row = await findUserByIdWithHash(req.user.id);
  if (typeof currentPassword !== 'string' || !(await verifyPassword(row.password_hash, currentPassword))) {
    await writeAudit({
      actorUserId: req.user.id,
      eventType: 'PASSWORD_CHANGE',
      outcome: 'failure',
      ip: req.ip,
      metadata: { reason: 'wrong_current_password' },
    });
    return sendError(res, 401, 'INVALID_CURRENT_PASSWORD', 'Mật khẩu hiện tại không đúng');
  }

  const passwordError = validateNewPassword(newPassword);
  if (passwordError) return sendError(res, 400, 'VALIDATION_ERROR', passwordError);
  if (newPassword === currentPassword) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu hiện tại');
  }

  const newHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    await updatePasswordHash(req.user.id, newHash, { mustChangePassword: false }, client);
    await revokeAllUserSessions(req.user.id, client);
    await writeAudit(
      { actorUserId: req.user.id, eventType: 'PASSWORD_CHANGE', outcome: 'success', ip: req.ip },
      client
    );
  });

  clearSessionCookie(res);
  return res.json({ message: 'Đổi mật khẩu thành công, vui lòng đăng nhập lại' });
});

/**
 * POST /api/auth/refresh — không dùng.
 * Hệ thống dùng phiên lưu trong CSDL, tự gia hạn mỗi lần gọi API (SEC-02: hết hạn sau
 * 15 phút không hoạt động), nên không cần cặp access/refresh token.
 */
