import { Router } from 'express';
import { requireAuth, requireCsrf } from '../middleware/auth.js';
import { requireJsonBody } from '../middleware/sameOrigin.js';
import { sendError } from '../lib/httpError.js';
import { consumeRecoveryLimit } from '../lib/recoveryLimiter.js';
import {
  sendVerification,
  verifyEmail,
  changeEmail,
} from '../services/emailVerification.js';

export const emailRouter = Router();

emailRouter.post(
  '/email/send-verification',
  requireAuth,
  requireCsrf,
  requireJsonBody,
  async (req, res) => {
    const wait = consumeRecoveryLimit('emailVerification', req.user.id, req.ip);

    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Vui lòng thử lại sau');
    }

    try {
      const sent = await sendVerification({
        userId: req.user.id,
        ip: req.ip,
      });

      if (!sent) {
        return sendError(
          res, 400, 'EMAIL_VERIFICATION_UNAVAILABLE',
          'Email chưa được thiết lập hoặc đã được xác minh'
        );
      }

      return res.json({ message: 'Đã gửi email xác minh' });
    } catch {
      return sendError(
        res, 503, 'EMAIL_SERVICE_UNAVAILABLE',
        'Không thể gửi email, vui lòng thử lại sau'
      );
    }
  }
);

emailRouter.post(
  '/email/verify',
  requireAuth,
  requireCsrf,
  requireJsonBody,
  async (req, res) => {
    const { token } = req.body ?? {};
    let recoveryCodes;

    const verified = await verifyEmail({
      userId: req.user.id,
      token,
      ip: req.ip,
      onRecoveryCodes: (codes) => {
        recoveryCodes = codes;
      },
    });

    if (!verified) {
      return sendError(
        res, 400, 'INVALID_VERIFICATION_TOKEN',
        'Token xác minh không hợp lệ hoặc đã hết hạn'
      );
    }

    return res.json({
      message: 'Xác minh email thành công',
      ...(recoveryCodes ? { recoveryCodes } : {}),
    });
  }
);

emailRouter.post(
  '/email/change',
  requireAuth,
  requireCsrf,
  requireJsonBody,
  async (req, res) => {
    const wait = consumeRecoveryLimit('emailChange', req.user.id, req.ip);

    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Vui lòng thử lại sau');
    }

    const { newEmail, currentPassword } = req.body ?? {};

    try {
      const result = await changeEmail({
        userId: req.user.id,
        newEmail,
        currentPassword,
        ip: req.ip,
      });

      if (result.status === 'denied') {
        return sendError(
          res, 403, 'EMAIL_CHANGE_DENIED',
          'Không đủ điều kiện thay đổi email hoặc mật khẩu không đúng'
        );
      }

      if (result.status === 'invalid_input') {
        return sendError(
          res, 400, 'VALIDATION_ERROR',
          'Email hoặc mật khẩu không hợp lệ'
        );
      }

      if (result.status === 'unchanged') {
        return sendError(
          res, 400, 'EMAIL_UNCHANGED',
          'Email mới phải khác email hiện tại'
        );
      }

      return res.json({
        message: 'Đã thay đổi email. Vui lòng xác minh email mới.',
      });
    } catch (error) {
      if (
        error.code === '23505' &&
        error.constraint === 'users_email_unique_idx'
      ) {
        return sendError(res, 409, 'EMAIL_TAKEN', 'Email đã được sử dụng');
      }

      throw error;
    }
  }
);