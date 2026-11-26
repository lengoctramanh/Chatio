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

describe('Task 5B: Recovery Status API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('Chưa đăng nhập không được xem trạng thái', async () => {
    const res = await request(app)
      .get('/api/admin/recovery-codes/status');

    assert.equal(res.status, 401);
  });

  it('User thường không được xem trạng thái', async () => {
    await insertUser({ username: 'user1' });

    const login = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'user1',
        password: PASSWORD,
      });

    const res = await request(app)
      .get('/api/admin/recovery-codes/status')
      .set('Cookie', sessionCookieFrom(login));

    assert.equal(res.status, 403);
  });

  it('Admin nhận cảnh báo khi chưa có mã khôi phục', async () => {
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
      .get('/api/admin/recovery-codes/status')
      .set('Cookie', sessionCookieFrom(login));

    assert.equal(res.status, 200);
    assert.equal(res.body.remaining, 0);
    assert.equal(res.body.needsSetup, true);
    assert.ok(res.body.warning);
  });
});

after(async () => {
  await pool.end();
});