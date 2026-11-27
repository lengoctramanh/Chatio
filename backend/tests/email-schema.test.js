import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, insertUser } from './helpers.js';

describe('Task 5B: Email Schema', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('Lưu email chưa xác minh', async () => {
    const id = await insertUser({ username: 'user1' });

    await pool.query(
      'UPDATE users SET email = $2 WHERE id = $1',
      [id, 'user1@example.com']
    );

    const { rows } = await pool.query(
      'SELECT email, email_verified_at FROM users WHERE id = $1',
      [id]
    );

    assert.equal(rows[0].email, 'user1@example.com');
    assert.equal(rows[0].email_verified_at, null);
  });

  it('Unique index email tồn tại và hợp lệ', async () => {
    const { rows } = await pool.query(`
      SELECT indisunique, indisvalid
      FROM pg_index
      WHERE indexrelid = 'users_email_unique_idx'::regclass
    `);

    assert.equal(rows[0].indisunique, true);
    assert.equal(rows[0].indisvalid, true);
  });

  it('Bảng token xác minh email đã tồn tại', async () => {
    const { rows } = await pool.query(`
      SELECT to_regclass(
        'public.email_verification_tokens'
      ) AS name
    `);

    assert.equal(rows[0].name, 'email_verification_tokens');
  });
});

after(async () => {
  await pool.end();
});
it('Email duy nhất không phân biệt hoa thuong', async () => {
  await resetDatabase();

  const first = await insertUser({ username: 'user1' });
  const second = await insertUser({ username: 'user2' });

  await pool.query(
    'UPDATE users SET email = $2 WHERE id = $1',
    [first, 'user@example.com']
  );

  await assert.rejects(
    pool.query(
      'UPDATE users SET email = $2 WHERE id = $1',
      [second, 'USER@EXAMPLE.COM']
    ),
    { code: '23505', constraint: 'users_email_unique_idx' }
  );
});
