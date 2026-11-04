import { config } from '../config.js';
import { writeAudit } from '../lib/audit.js';
import { isValidCsrfToken } from '../lib/csrf.js';
import { sendError } from '../lib/httpError.js';
import { findActiveSession } from '../lib/sessions.js';

/*
 * Middleware dùng chung cho các module chat, file và quản trị.
 *
 *   router.get('/x', requireAuth, handler)                          // đã đăng nhập
 *   router.post('/x', requireAuth, requireCsrf, handler)            // thay đổi dữ liệu
 *   router.get('/admin/x', requireAuth, requireRole('admin'), handler)
 *
 * Sau requireAuth: req.user = { id, username, role, status, mustChangePassword },
 * req.sessionId = id phiên hiện tại.
 */

const loadSession = (mustHaveChangedPassword) => async (req, res, next) => {
  const session = await findActiveSession(req.cookies?.[config.session.cookieName]);
  if (!session) {
    return sendError(res, 401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
  }
  if (mustHaveChangedPassword && session.user.mustChangePassword) {
    return sendError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Bạn cần đổi mật khẩu trước khi tiếp tục');
  }
  req.user = session.user;
  req.sessionId = session.sessionId;
  return next();
};

/** Bắt buộc đăng nhập và đã đổi mật khẩu lần đầu. Dùng cho hầu hết API. */
export const requireAuth = loadSession(true);

/**
 * Bắt buộc đăng nhập nhưng cho phép tài khoản chưa đổi mật khẩu lần đầu.
 * Chỉ dùng cho /auth/me, /auth/change-password.
 */
export const requireSession = loadSession(false);

/**
 * Kiểm tra vai trò. Phải đặt sau requireAuth.
 * @param {...('admin'|'user')} roles
 */
export const requireRole =
  (...roles) =>
  async (req, res, next) => {
    if (!req.user) {
      return sendError(res, 401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (!roles.includes(req.user.role)) {
      await writeAudit({
        actorUserId: req.user.id,
        eventType: 'ACCESS_DENIED',
        outcome: 'failure',
        ip: req.ip,
        metadata: { method: req.method, path: req.originalUrl, requiredRole: roles.join(',') },
      });
      return sendError(res, 403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này');
    }
    return next();
  };

/**
 * ACC-04: kiểm tra header X-CSRF-Token cho thao tác thay đổi dữ liệu.
 * Phải đặt sau requireAuth/requireSession. Lấy token từ /auth/login hoặc /auth/me.
 */
export const requireCsrf = (req, res, next) => {
  if (!req.sessionId || !isValidCsrfToken(req.sessionId, req.get('x-csrf-token'))) {
    return sendError(res, 403, 'CSRF_INVALID', 'CSRF token không hợp lệ');
  }
  return next();
};
