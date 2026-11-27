import { config } from '../config.js';
import { withTransaction } from '../db/pool.js';
import { writeAudit } from '../lib/audit.js';
import { generateToken, hashToken } from '../lib/emailTokens.js';
import { normalizeEmail } from '../lib/emailAddress.js';
import { verifyPassword } from '../lib/passwords.js';
import { issueInitialRecoveryCodes } from './adminRecovery.js';
import { invalidateResetTokens } from './passwordRecovery.js';
import { mailer } from './mailer.js';

export const sendVerification = async ({
  userId,
  ip,
  emailMailer = mailer,
}) => {
  const token = generateToken();

  const email = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT email, email_verified_at, status
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    const user = rows[0];
    if (!user?.email || user.email_verified_at || user.status !== 'active') {
      return null;
    }

    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    await client.query(
      `INSERT INTO email_verification_tokens
        (user_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes')`,
      [userId, user.email, hashToken(token)]
    );

    await writeAudit({
      actorUserId: userId,
      eventType: 'EMAIL_VERIFICATION_REQUEST',
      outcome: 'success',
      ip,
    }, client);

    return user.email;
  });

  if (!email) return false;

  const url = new URL('/verify-email', config.appPublicUrl);
  url.searchParams.set('token', token);

  await emailMailer.sendMail({
    to: email,
    subject: 'Xác minh email Chatio',
    text: `Link xác minh email (có hiệu lực trong 15 phút):\n${url}`,
  });

  return true;
};

export const verifyEmail = async ({ userId, token, ip, onRecoveryCodes }) => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }

  const result = await withTransaction(async (client) => {
    const { rows: [user] } = await client.query(
      `SELECT email, status FROM users
       WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (!user?.email || user.status !== 'active') return false;

    const { rowCount } = await client.query(
      `UPDATE email_verification_tokens
       SET used_at = now()
       WHERE user_id = $1
         AND token_hash = $2
         AND email = $3
         AND used_at IS NULL
         AND expires_at > now()`,
      [userId, hashToken(token), user.email]
    );

    if (rowCount !== 1) return false;

    await client.query(
      `UPDATE users
       SET email_verified_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId]
    );

    await writeAudit({
      actorUserId: userId,
      eventType: 'EMAIL_VERIFIED',
      outcome: 'success',
      ip,
    }, client);

    return {
      recoveryCodes: onRecoveryCodes
        ? await issueInitialRecoveryCodes(userId, client)
        : null,
    };
  });

  if (!result) return false;
  if (result.recoveryCodes) onRecoveryCodes(result.recoveryCodes);
  return true;
};

export const changeEmail = async ({
  userId,
  newEmail,
  currentPassword,
  ip,
  emailMailer = mailer,
}) => {
  const email = normalizeEmail(newEmail);

  if (
    !email ||
    typeof currentPassword !== 'string' ||
    currentPassword.length > config.password.maxLength
  ) {
    return { status: 'invalid_input' };
  }

  const result = await withTransaction(async (client) => {
    const { rows: [user] } = await client.query(
      `SELECT email, email_verified_at, password_hash,
              status, must_change_password
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (
      !user ||
      user.status !== 'active' ||
      user.must_change_password ||
      !(await verifyPassword(user.password_hash, currentPassword))
    ) {
      return { status: 'denied' };
    }

    if (user.email?.toLowerCase() === email) {
      return { status: 'unchanged' };
    }

    await client.query(
      `UPDATE users
       SET email = $2, email_verified_at = NULL, updated_at = now()
       WHERE id = $1`,
      [userId, email]
    );

    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    await invalidateResetTokens(userId, client);

    await writeAudit({
      actorUserId: userId,
      eventType: 'EMAIL_CHANGE',
      outcome: 'success',
      ip,
    }, client);

    return {
      status: 'success',
      oldEmail: user.email_verified_at ? user.email : null,
    };
  });

  if (result.status === 'success' && result.oldEmail) {
    try {
      await emailMailer.sendMail({
        to: result.oldEmail,
        subject: 'Cảnh báo thay đổi email Chatio',
        text: 'Địa chỉ email của tài khoản Chatio đã được thay đổi. Nếu bạn không thực hiện thao tác này, hãy liên hệ quản trị hệ thống.',
      });
    } catch {
      console.error('Không gửi được cảnh báo thay đổi email');
    }
  }

  return { status: result.status };
};