import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import {
  app,
  pool,
  resetDatabase,
  insertUser,
  PASSWORD,
  sessionCookieFrom,
} from './helpers.js';

describe('Task 5B: Single Admin', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('Tạo admin đầu tiên thành công', async () => {
    const id = await insertUser({
      username: 'admin',
      role: 'admin',
    });

    const { rows } = await pool.query(
      'SELECT global_role FROM users WHERE id = $1',
      [id]
    );

    assert.equal(rows[0].global_role, 'admin');
  });

  it('Cho phép nhiều user thường', async () => {
    await insertUser({ username: 'user1' });
    await insertUser({ username: 'user2' });

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users WHERE global_role = 'user'`
    );

    assert.equal(rows[0].total, 2);
  });

  it('Unique index giới hạn admin hợp lệ', async () => {
    const { rows } = await pool.query(`
      SELECT indisunique, indisvalid
      FROM pg_index
      WHERE indexrelid = 'users_single_admin_idx'::regclass
    `);

    assert.equal(rows[0].indisunique, true);
    assert.equal(rows[0].indisvalid, true);
  });

  it('Admin tạo user có must_change_password', async () => {
    await insertUser({
      username: 'admin',
      role: 'admin',
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: PASSWORD,
      });

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', sessionCookieFrom(login))
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({
        username: 'newuser',
        password: PASSWORD,
        role: 'user',
        email: 'newuser@example.com',
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.mustChangePassword, true);

    const { rows } = await pool.query(
      `SELECT email, email_verified_at
       FROM users WHERE username = $1`,
      ['newuser']
    );

    assert.equal(rows[0].email, 'newuser@example.com');
    assert.equal(rows[0].email_verified_at, null);
  });
});

after(async () => {
  await pool.end();
});
it('Database từ chối admin thứ hai', async () => {
  await resetDatabase();

  await insertUser({ username: 'admin1', role: 'admin' });

  await assert.rejects(
    insertUser({ username: 'admin2', role: 'admin' }),
    { code: '23505', constraint: 'users_single_admin_idx' }
  );
});

it('Tạo admin đồng thời vẫn chỉ có một admin', async () => {
  await resetDatabase();

  const results = await Promise.allSettled([
    insertUser({ username: 'admin1', role: 'admin' }),
    insertUser({ username: 'admin2', role: 'admin' }),
  ]);

  assert.equal(
    results.filter(result => result.status === 'fulfilled').length,
    1
  );

  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS total FROM users WHERE global_role = 'admin'"
  );

  assert.equal(rows[0].total, 1);
});
