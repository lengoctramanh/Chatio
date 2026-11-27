import { pool, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { generateToken, hashToken } from '../lib/emailTokens.js';
import { writeAudit } from '../lib/audit.js';
import { consumeRecoveryLimit } from '../lib/recoveryLimiter.js';
import { mailer } from './mailer.js';
import { hashPassword, validateNewPassword } from '../lib/passwords.js';
import { revokeAllUserSessions } from '../lib/sessions.js';
import { updatePasswordHash } from '../models/user.js';
import { hashRecoveryCode } from './adminRecovery.js';
export const FORGOT_PASSWORD_MESSAGE =
  'Nếu tài khoản tồn tại và có email đã xác minh, hướng dẫn đặt lại mật khẩu sẽ được gửi.';

export const buildResetUrl = (token) => {
  const url = new URL('/reset-password', config.appPublicUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

export const invalidateResetTokens = async (userId, db = pool) => {
  const result = await db.query(
    `UPDATE password_reset_tokens
     SET used_at = now()
     WHERE user_id = $1
       AND used_at IS NULL`,
    [userId]
  );

  return result.rowCount;
};

export const requestPasswordReset = async ({
  usernameOrEmail,
  ip,
  emailMailer = mailer,
}) => {
  const identifier =
    typeof usernameOrEmail === 'string'
      ? usernameOrEmail.trim().toLowerCase()
      : '';

  if (!identifier || identifier.length > 254) {
    return;
  }

  if (consumeRecoveryLimit('forgotPassword', identifier, ip) > 0) {
    return;
  }

  const token = generateToken();

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, global_role, status, email_verified_at
       FROM users
       WHERE LOWER(username) = $1 OR LOWER(email) = $1
       FOR UPDATE`,
      [identifier]
    );

    const user = rows.length === 1 ? rows[0] : null;

    if (
      !user ||
      user.status !== 'active' ||
      !user.email ||
      !user.email_verified_at
    ) {
      return null;
    }
    if (consumeRecoveryLimit('forgotPasswordAccount', user.id) > 0) {
      return null;
}
    await invalidateResetTokens(user.id, client);

    await client.query(
      `INSERT INTO password_reset_tokens
        (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + interval '15 minutes', $3)`,
      [user.id, hashToken(token), ip?.slice(0, 45) ?? null]
    );

    await writeAudit(
      {
        actorUserId: user.id,
        eventType: 'PASSWORD_RESET_REQUEST',
        outcome: 'success',
        ip,
      },
      client
    );

    return user.email;
  });

  if (!result) return;

  try {
    await emailMailer.sendMail({
      to: result,
      subject: 'Khôi phục mật khẩu Chatio',
      text: `Yêu cầu đặt lại mật khẩu Chatio.\nLink có hiệu lực 15 phút:\n${buildResetUrl(token)}\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
    });
  } catch {
    console.error('Không gửi được email khôi phục');
  }
};
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RECOVERY_CODE_PATTERN = /^[a-f0-9]{32}$/i;

export const resetPassword = async ({
  token,
  newPassword,
  recoveryCode,
  ip,
  emailMailer = mailer,
}) => {
  const tokenHash =
    typeof token === 'string' && RESET_TOKEN_PATTERN.test(token)
      ? hashToken(token)
      : null;

  const retryAfter = consumeRecoveryLimit(
    'resetPassword',
    tokenHash ?? 'invalid-format',
    ip
  );

  const fail = async (db = pool, actorUserId = null, wait = 0) => {
    await writeAudit({
      actorUserId,
      eventType: 'PASSWORD_RESET_FAILURE',
      outcome: 'failure',
      ip,
    }, db);

    return wait > 0
      ? { status: 'rate_limited', retryAfter: wait }
      : { status: 'invalid_credentials' };
  };

  if (retryAfter > 0) {
    return { status: 'rate_limited', retryAfter };
  }

  if (!tokenHash) return fail();

  const result = await withTransaction(async (client) => {
    // Khóa user trước để cùng thứ tự với forgot-password và script.
    const { rows: [user] } = await client.query(
      `SELECT u.id, u.email, u.email_verified_at, u.global_role, u.status
       FROM users u
       JOIN password_reset_tokens t ON t.user_id = u.id
       WHERE t.token_hash = $1
       FOR UPDATE OF u`,
      [tokenHash]
    );

    if (!user || user.status !== 'active' || !user.email || !user.email_verified_at) {
      return fail(client, user?.id);
    }

    const { rows: [resetToken] } = await client.query(
      `SELECT id
       FROM password_reset_tokens
       WHERE user_id = $1 AND token_hash = $2
         AND used_at IS NULL AND expires_at > clock_timestamp()
       FOR UPDATE`,
      [user.id, tokenHash]
    );

    if (!resetToken) return fail(client, user.id);

    let codeId;
    if (user.global_role === 'admin') {
      const wait = consumeRecoveryLimit('recoveryCodeAttempt', user.id, ip);
      if (wait > 0) return fail(client, user.id, wait);

      const code = typeof recoveryCode === 'string' ? recoveryCode.trim() : '';
      if (!RECOVERY_CODE_PATTERN.test(code)) return fail(client, user.id);

      const { rows: [storedCode] } = await client.query(
        `SELECT id FROM admin_recovery_codes
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         FOR UPDATE`,
        [user.id, hashRecoveryCode(code)]
      );

      if (!storedCode) return fail(client, user.id);
      codeId = storedCode.id;
    }

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) {
      await fail(client, user.id);
      return { status: 'invalid_password', message: passwordError };
    }

    const passwordHash = await hashPassword(newPassword);

    const consumed = await client.query(
      `UPDATE password_reset_tokens SET used_at = clock_timestamp()
       WHERE id = $1 AND used_at IS NULL AND expires_at > clock_timestamp()`,
      [resetToken.id]
    );
    if (consumed.rowCount !== 1) return fail(client, user.id);

    if (codeId) {
      await client.query(
        'UPDATE admin_recovery_codes SET used_at = clock_timestamp() WHERE id = $1',
        [codeId]
      );
    }

    await updatePasswordHash(
      user.id, passwordHash, { mustChangePassword: false }, client
    );
    await revokeAllUserSessions(user.id, client);
    await invalidateResetTokens(user.id, client);

    await writeAudit({
      actorUserId: user.id,
      eventType: 'PASSWORD_RESET_SUCCESS',
      outcome: 'success',
      ip,
    }, client);

    return { status: 'success', email: user.email };
  });

  if (result.status !== 'success') return result;

  try {
    await emailMailer.sendMail({
      to: result.email,
      subject: 'Cảnh báo bảo mật Chatio',
      text: 'Mật khẩu Chatio của bạn vừa được đặt lại. Nếu bạn không thực hiện thao tác này, hãy liên hệ quản trị hệ thống.',
    });
  } catch {
    console.error('Không gửi được email cảnh báo đặt lại mật khẩu');
  }

  return { status: 'success' };
};