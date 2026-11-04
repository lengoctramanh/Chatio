import { pool } from '../db/pool.js';

// Bảng users do migration 1793608304401_initial-schema.js tạo.
// password_hash chỉ được đọc trong các hàm có hậu tố "WithHash" và không bao giờ trả ra API.

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,50}$/;
export const ROLES = Object.freeze(['user', 'admin']);
export const STATUSES = Object.freeze(['active', 'locked', 'disabled']);

const PUBLIC_COLUMNS = `id, username, global_role, status, must_change_password, created_at, updated_at`;

/** Chuyển một dòng DB thành object an toàn để trả về client. */
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
  const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toPublicUser(rows[0]) : null;
};

/**
 * Tạo tài khoản. Ném lỗi pg code 23505 nếu username đã tồn tại.
 * Tài khoản mới luôn phải đổi mật khẩu ở lần đăng nhập đầu (ACC-01).
 */
export const createUser = async ({ username, passwordHash, role = 'user' }, db = pool) => {
  const { rows } = await db.query(
    `INSERT INTO users (username, password_hash, global_role, must_change_password)
     VALUES ($1, $2, $3, TRUE)
     RETURNING ${PUBLIC_COLUMNS}`,
    [username, passwordHash, role]
  );
  return toPublicUser(rows[0]);
};

export const updatePasswordHash = (userId, passwordHash, { mustChangePassword }, db = pool) =>
  db.query(
    `UPDATE users
        SET password_hash = $2, must_change_password = $3, updated_at = now()
      WHERE id = $1`,
    [userId, passwordHash, mustChangePassword]
  );
