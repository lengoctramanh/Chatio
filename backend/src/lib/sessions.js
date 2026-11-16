import crypto from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

// Token gốc chỉ nằm trong cookie của trình duyệt; DB chỉ lưu SHA-256 của token.
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 byte base64url

/**
 * Tạo phiên mới cho user.
 * @returns {Promise<{ token: string, sessionId: string, expiresAt: Date }>}
 */
export const createSession = async (userId, db = pool) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows } = await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))
     RETURNING id, expires_at`,
    [userId, hashToken(token), config.session.absoluteHours]
  );
  return { token, sessionId: rows[0].id, expiresAt: rows[0].expires_at };
};

/**
 * Tìm phiên còn hiệu lực theo token và gia hạn last_activity_at.
 * Phiên hợp lệ khi: chưa bị thu hồi, chưa quá hạn tuyệt đối, chưa quá 15 phút
 * không hoạt động, và tài khoản đang active. Dùng được cho cả Socket.IO handshake.
 * @returns {Promise<null | { sessionId: string, user: { id: string, username: string,
 *   role: 'admin'|'user', status: string, mustChangePassword: boolean } }>}
 */
export const findActiveSession = async (token) => {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;

  const { rows } = await pool.query(
    `UPDATE sessions s
        SET last_activity_at = now()
       FROM users u
      WHERE s.token_hash = $1
        AND u.id = s.user_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.last_activity_at > now() - make_interval(mins => $2)
        AND u.status = 'active'
  RETURNING s.id AS session_id, u.id, u.username, u.global_role,
            u.status, u.must_change_password`,
    [hashToken(token), config.session.idleMinutes]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      username: row.username,
      role: row.global_role,
      status: row.status,
      mustChangePassword: row.must_change_password,
    },
  };
};

export const revokeSession = (sessionId, db = pool) =>
  db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId]
  );

/**
 * Thu hồi mọi phiên của một user (ACC-03). Dùng khi đổi/đặt lại mật khẩu
 * hoặc khóa tài khoản. Trả về số phiên bị thu hồi.
 */
export const revokeAllUserSessions = async (userId, db = pool) => {
  const result = await db.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return result.rowCount;
};

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: config.session.cookieSecure,
  sameSite: 'strict',
  path: '/',
  maxAge: config.session.absoluteHours * 60 * 60 * 1000,
});

export const clearSessionCookie = (res) => {
  const { maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(config.session.cookieName, options);
};
