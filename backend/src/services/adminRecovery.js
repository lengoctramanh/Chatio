import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../db/pool.js';
import { hashToken } from '../lib/emailTokens.js';
import { verifyPassword } from '../lib/passwords.js';
import { writeAudit } from '../lib/audit.js';
import { mailer } from './mailer.js';

export const generateRecoveryCodes = () =>
  Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));

export const hashRecoveryCode = (code) =>
  hashToken(code.trim().toLowerCase());

export const countRemainingRecoveryCodes = async (userId, db = pool) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM admin_recovery_codes
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  return rows[0].total;
};

export const invalidateRecoveryCodes = async (userId, db = pool) => {
  const result = await db.query(
    `UPDATE admin_recovery_codes
     SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );

  return result.rowCount;
};

const insertRecoveryCodeSet = async (userId, client) => {
  const codes = generateRecoveryCodes();

  for (const code of codes) {
    await client.query(
      `INSERT INTO admin_recovery_codes (user_id, code_hash)
       VALUES ($1, $2)`,
      [userId, hashRecoveryCode(code)]
    );
  }

  return codes;
};

export const issueInitialRecoveryCodes = async (userId, client) => {
  // The caller holds the user row lock in this transaction.
  const { rowCount } = await client.query(
    `SELECT 1 FROM users u
     WHERE u.id = $1 AND u.global_role = 'admin' AND u.status = 'active'
       AND NOT u.must_change_password AND u.email IS NOT NULL
       AND u.email_verified_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM admin_recovery_codes c WHERE c.user_id = u.id
       )`,
    [userId]
  );

  if (rowCount !== 1) return null;

  const codes = await insertRecoveryCodeSet(userId, client);
  await writeAudit({
    actorUserId: userId,
    eventType: 'RECOVERY_CODES_ISSUED',
    outcome: 'success',
  }, client);

  return codes;
};

export const regenerateRecoveryCodes = async ({
  userId,
  currentPassword,
  ip,
  emailMailer = mailer,
}) => {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT password_hash, global_role, status,
              must_change_password, email, email_verified_at
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    const user = rows[0];

    if (
      !user ||
      user.global_role !== 'admin' ||
      user.status !== 'active' ||
      user.must_change_password ||
      !user.email ||
      !user.email_verified_at
    ) {
      return null;
    }

    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length > 256 ||
      !(await verifyPassword(user.password_hash, currentPassword))
    ) {
      return null;
    }

    await invalidateRecoveryCodes(userId, client);
    const codes = await insertRecoveryCodeSet(userId, client);

    await writeAudit({
      actorUserId: userId,
      eventType: 'RECOVERY_CODES_REGENERATED',
      outcome: 'success',
      ip,
    }, client);

    return { codes, email: user.email };
  });

  if (!result) return null;

  try {
    await emailMailer.sendMail({
      to: result.email,
      subject: 'Cảnh báo bảo mật Chatio',
      text: 'Bộ mã khôi phục của tài khoản quản trị viên đã được tạo lại. Nếu bạn không thực hiện thao tác này, hãy kiểm tra bảo mật tài khoản ngay.',
    });
  } catch {
    console.error('Không gửi được email cảnh báo bảo mật');
  }

  return result.codes;
};