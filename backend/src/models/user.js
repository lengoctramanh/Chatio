import { pool } from '../db/pool.js';

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
export const ROLES = Object.freeze(['user', 'admin']);
export const STATUSES = Object.freeze(['active', 'locked', 'disabled']);

const PUBLIC_COLUMNS = `id, username, global_role, status, must_change_password, created_at, updated_at`;

export const toPublicUser = (row) => ({
  id: row.id,
  username: row.username,
  role: row.global_role,
  status: row.status,
  mustChangePassword: row.must_change_password,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const findUserByUsernameWithHash = async (username, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = $1`,
    [username]
  );

  return rows[0] ?? null;
};

export const findUserByIdWithHash = async (id, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE id = $1`,
    [id]
  );

  return rows[0] ?? null;
};

export const findUserById = async (id, db = pool) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );

  return rows[0] ? toPublicUser(rows[0]) : null;
};

/**
 * Tạo tài khoản user thông thường.
 * Tài khoản mới luôn phải đổi mật khẩu lần đầu.
 * Email chưa được xác minh khi tạo tài khoản.
 */
export const createUser = async ({
  username,
  passwordHash,
  email = null,
}, db = pool) => {
  const { rows } = await db.query(
    `INSERT INTO users (
      username,
      password_hash,
      global_role,
      must_change_password,
      email
    )
    VALUES ($1, $2, 'user', TRUE, $3)
    RETURNING ${PUBLIC_COLUMNS}`,
    [username, passwordHash, email]
  );

  return toPublicUser(rows[0]);
};

export const updatePasswordHash = (
  userId,
  passwordHash,
  { mustChangePassword },
  db = pool
) => db.query(
  `UPDATE users
   SET password_hash = $2,
       must_change_password = $3,
       updated_at = now()
   WHERE id = $1`,
  [userId, passwordHash, mustChangePassword]
);