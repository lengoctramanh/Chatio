import { Router } from 'express';
import { config } from '../config.js';
import { isValidCsrfToken } from '../lib/csrf.js';
import { sendError } from '../lib/httpError.js';
import { consumeRecoveryLimit } from '../lib/recoveryLimiter.js';
import { findActiveSession } from '../lib/sessions.js';
import {
  requireAuth,
  requireRole,
  requireCsrf,
} from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/sameOrigin.js';
import { regenerateRecoveryCodes } from '../services/adminRecovery.js';
import {
  FORGOT_PASSWORD_MESSAGE,
  requestPasswordReset,
  resetPassword,
} from '../services/passwordRecovery.js';

export const passwordRecoveryRouter = Router();

passwordRecoveryRouter.post(
  '/forgot-password',
  requireJsonBody,
  async (req, res) => {
    const { usernameOrEmail } = req.body ?? {};

    void requestPasswordReset({
      usernameOrEmail,
      ip: req.ip,
    }).catch(() => console.error('Không xử lý được yêu cầu khôi phục'));

    return res.json({
      message: FORGOT_PASSWORD_MESSAGE,
    });
  }
);

passwordRecoveryRouter.post(
  '/reset-password',
  requireJsonBody,
  async (req, res) => {
    const session = await findActiveSession(
      req.cookies?.[config.session.cookieName]
    );

    if (
      session &&
      !isValidCsrfToken(session.sessionId, req.get('x-csrf-token'))
    ) {
      return sendError(res, 403, 'CSRF_INVALID', 'CSRF token không hợp lệ');
    }

    const { token, newPassword, recoveryCode } = req.body ?? {};
    const result = await resetPassword({
      token,
      newPassword,
      recoveryCode,
      ip: req.ip,
    });

    if (result.status === 'rate_limited') {
      res.set('Retry-After', String(result.retryAfter));

      return sendError(
        res,
        429,
        'TOO_MANY_ATTEMPTS',
        'Vui lòng thử lại sau'
      );
    }

    if (result.status === 'invalid_password') {
      return sendError(res, 400, 'VALIDATION_ERROR', result.message);
    }

    if (result.status !== 'success') {
      return sendError(
        res,
        400,
        'INVALID_RESET_CREDENTIALS',
        'Thông tin đặt lại mật khẩu không hợp lệ hoặc đã hết hạn'
      );
    }

    return res.json({
      message: 'Đặt lại mật khẩu thành công, vui lòng đăng nhập lại',
    });
  }
);

passwordRecoveryRouter.post(
  '/recovery-codes/regenerate',
  requireAuth,
  requireRole('admin'),
  requireCsrf,
  requireJsonBody,
  async (req, res) => {
    const wait = consumeRecoveryLimit('recoveryCodes', req.user.id, req.ip);

    if (wait > 0) {
      res.set('Retry-After', String(wait));

      return sendError(
        res,
        429,
        'TOO_MANY_ATTEMPTS',
        'Vui lòng thử lại sau'
      );
    }

    const { currentPassword } = req.body ?? {};
    const codes = await regenerateRecoveryCodes({
      userId: req.user.id,
      currentPassword,
      ip: req.ip,
    });

    if (!codes) {
      return sendError(
        res,
        403,
        'RECOVERY_CODES_DENIED',
        'Không đủ điều kiện tạo mã khôi phục hoặc mật khẩu không đúng'
      );
    }

    res.set('Cache-Control', 'no-store');

    return res.json({
      recoveryCodes: codes,
      message: 'Hãy lưu mã ở nơi an toàn bên ngoài email. Mã chỉ được hiển thị một lần.',
    });
  }
);