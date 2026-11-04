import pg from 'pg';
import '../config.js';

// Có DATABASE_URL (chạy ngoài Docker) thì dùng; nếu không, pg tự đọc PGHOST, PGUSER... từ compose.yaml.
// SEC-08: giới hạn số kết nối và thời gian truy vấn.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  max: 10,
  statement_timeout: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (error) => {
  console.error('PostgreSQL pool error:', error.message);
});

/**
 * Chạy fn trong một transaction; tự ROLLBACK khi có lỗi.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
