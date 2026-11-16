// Chuẩn bị môi trường test: dùng CSDL riêng (TEST_DATABASE_URL), chạy migration,
// rồi mới import app để pool kết nối đúng CSDL test.
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error('Chưa đặt TEST_DATABASE_URL trong .env (xem README, mục Kiểm thử)');
}
if (!new URL(testUrl).pathname.endsWith('_test')) {
  // Test sẽ xóa dữ liệu; chặn chạy nhầm vào CSDL chính.
  throw new Error('TEST_DATABASE_URL phải trỏ tới CSDL có tên kết thúc bằng _test');
}

process.env.DATABASE_URL = testUrl;
process.env.CSRF_SECRET ||= 'test-only-csrf-secret-at-least-32-characters';
process.env.COOKIE_SECURE = 'true';
process.env.LOGIN_LIMIT_PER_ACCOUNT = '5';
process.env.LOGIN_LIMIT_PER_IP = '1000';

const { runner } = await import('node-pg-migrate');
await runner({
  databaseUrl: testUrl,
  dir: fileURLToPath(new URL('../database/migrations', import.meta.url)),
  direction: 'up',
  migrationsTable: 'pgmigrations',
  log: () => {},
});

const { app } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const { resetLoginLimiter } = await import('../src/lib/loginLimiter.js');

export { app, pool };

export const PASSWORD = 'correct-horse-battery-staple';

export const resetDatabase = async () => {
  resetLoginLimiter();
  await pool.query('TRUNCATE audit_logs, sessions, users RESTART IDENTITY CASCADE');
};

/** Tạo user trực tiếp trong CSDL (bỏ qua API) để chuẩn bị dữ liệu test. */
export const insertUser = async ({
  username,
  role = 'user',
  status = 'active',
  mustChangePassword = false,
  password = PASSWORD,
}) => {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, global_role, status, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [username, await hashPassword(password), role, status, mustChangePassword]
  );
  return rows[0].id;
};

/** Lấy cookie phiên từ header Set-Cookie (dạng "chatio_sid=..."). */
export const sessionCookieFrom = (res) => {
  const header = [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('chatio_sid='));
  return header?.split(';')[0];
};
