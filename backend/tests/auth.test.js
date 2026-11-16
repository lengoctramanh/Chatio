import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import {
  PASSWORD,
  app,
  insertUser,
  pool,
  resetDatabase,
  sessionCookieFrom,
} from './helpers.js';

const login = (username, password = PASSWORD) =>
  request(app).post('/api/auth/login').send({ username, password });

/** Đăng nhập và trả về { cookie, csrf, body }. */
const loginOk = async (username, password = PASSWORD) => {
  const res = await login(username, password);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { cookie: sessionCookieFrom(res), csrf: res.body.csrfToken, body: res.body };
};

const NEW_USER_PASSWORD = 'a-brand-new-password-123';

beforeEach(resetDatabase);
after(() => pool.end());

describe('Đăng ký (admin tạo tài khoản)', () => {
  test('admin tạo tài khoản thành công, không trả password/hash', async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    const { cookie, csrf } = await loginOk('admin');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ username: 'alice', password: NEW_USER_PASSWORD });

    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, 'alice');
    assert.equal(res.body.user.role, 'user');
    assert.equal(res.body.user.mustChangePassword, true);
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('password_hash') && !raw.includes('$argon2'));

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE username = 'alice'`);
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
    assert.notEqual(rows[0].password_hash, NEW_USER_PASSWORD);
  });

  test('username đã tồn tại → 409', async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    await insertUser({ username: 'alice' });
    const { cookie, csrf } = await loginOk('admin');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ username: 'alice', password: NEW_USER_PASSWORD });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'USERNAME_TAKEN');
  });

  test('mật khẩu ngắn hơn 15 ký tự → 400', async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    const { cookie, csrf } = await loginOk('admin');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ username: 'bob', password: 'short-pass' });

    assert.equal(res.status, 400);
  });

  test('không có đăng ký công khai: chưa đăng nhập → 401', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'mallory', password: NEW_USER_PASSWORD });
    assert.equal(res.status, 401);
  });

  test('user thường gọi register → 403', async () => {
    await insertUser({ username: 'alice' });
    const { cookie, csrf } = await loginOk('alice');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ username: 'mallory', password: NEW_USER_PASSWORD });
    assert.equal(res.status, 403);
  });

  test('admin thiếu CSRF token → 403', async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    const { cookie } = await loginOk('admin');

    const res = await request(app)
      .post('/api/auth/register')
      .set('Cookie', cookie)
      .send({ username: 'bob', password: NEW_USER_PASSWORD });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CSRF_INVALID');
  });
});

describe('Đăng nhập', () => {
  test('đúng mật khẩu → 200, cookie HttpOnly/Secure/SameSite, có CSRF token', async () => {
    await insertUser({ username: 'alice' });
    const res = await login('alice');

    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'alice');
    assert.ok(res.body.csrfToken);
    assert.ok(!JSON.stringify(res.body).includes('$argon2'));

    const setCookie = [res.headers['set-cookie']].flat().join(';');
    assert.match(setCookie, /chatio_sid=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Strict/i);

    // DB chỉ lưu hash của token, không lưu token gốc.
    const token = sessionCookieFrom(res).split('=')[1];
    const { rows } = await pool.query('SELECT token_hash FROM sessions');
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token);
  });

  test('sai mật khẩu và username không tồn tại → cùng 401 và cùng thông báo', async () => {
    await insertUser({ username: 'alice' });
    const wrongPass = await login('alice', 'wrong-password-123456');
    const noUser = await login('nobody', 'wrong-password-123456');

    assert.equal(wrongPass.status, 401);
    assert.equal(noUser.status, 401);
    assert.deepEqual(wrongPass.body, noUser.body);
    assert.equal(wrongPass.body.error.message, 'Thông tin đăng nhập không chính xác');
    assert.equal(sessionCookieFrom(wrongPass), undefined);
  });

  test('tài khoản bị khóa không đăng nhập được, thông báo giống sai mật khẩu', async () => {
    await insertUser({ username: 'locked', status: 'locked' });
    const res = await login('locked');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('sai quá 5 lần → 429 kể cả khi nhập đúng mật khẩu', async () => {
    await insertUser({ username: 'alice' });
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await login('alice', 'wrong-password-123456')).status, 401);
    }
    const res = await login('alice');
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers['retry-after']) > 0);
  });

  test('ghi audit log, không chứa mật khẩu', async () => {
    await insertUser({ username: 'alice' });
    await login('alice', 'wrong-password-123456');
    await login('alice');

    const { rows } = await pool.query(
      `SELECT event_type, outcome, metadata_redacted FROM audit_logs ORDER BY id`
    );
    assert.deepEqual(
      rows.map((r) => `${r.event_type}:${r.outcome}`),
      ['LOGIN:failure', 'LOGIN:success']
    );
    const all = JSON.stringify(rows);
    assert.ok(!all.includes('wrong-password-123456') && !all.includes(PASSWORD));
  });
});

describe('requireAuth và /auth/me', () => {
  test('chưa đăng nhập → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
  });

  test('đã đăng nhập → trả thông tin user, không có hash', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'alice');
    assert.ok(res.body.csrfToken);
    assert.ok(!JSON.stringify(res.body).includes('$argon2'));
  });

  test('token giả mạo → 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `chatio_sid=${'A'.repeat(43)}`);
    assert.equal(res.status, 401);
  });

  test('phiên quá 15 phút không hoạt động → 401', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');
    await pool.query(`UPDATE sessions SET last_activity_at = now() - interval '16 minutes'`);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  test('phiên quá hạn tuyệt đối → 401', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');
    await pool.query(
      `UPDATE sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second'`
    );

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  test('tài khoản bị khóa sau khi đăng nhập → phiên cũ bị từ chối', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');
    await pool.query(`UPDATE users SET status = 'locked' WHERE username = 'alice'`);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    assert.equal(res.status, 401);
  });

  test('chưa đổi mật khẩu lần đầu: /me được, API khác → 403 PASSWORD_CHANGE_REQUIRED', async () => {
    await insertUser({ username: 'newadmin', role: 'admin', mustChangePassword: true });
    const { cookie, body } = await loginOk('newadmin');
    assert.equal(body.user.mustChangePassword, true);

    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);
    const res = await request(app).get('/api/admin/ping').set('Cookie', cookie);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  });
});

describe('requireRole("admin")', () => {
  test('admin truy cập API admin → 200', async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    const { cookie } = await loginOk('admin');

    const res = await request(app).get('/api/admin/ping').set('Cookie', cookie);
    assert.equal(res.status, 200);
  });

  test('user truy cập API admin → 403 và ghi ACCESS_DENIED', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');

    const res = await request(app).get('/api/admin/ping').set('Cookie', cookie);
    assert.equal(res.status, 403);

    const { rows } = await pool.query(
      `SELECT 1 FROM audit_logs WHERE event_type = 'ACCESS_DENIED' AND outcome = 'failure'`
    );
    assert.equal(rows.length, 1);
  });

  test('chưa đăng nhập truy cập API admin → 401', async () => {
    const res = await request(app).get('/api/admin/ping');
    assert.equal(res.status, 401);
  });
});

describe('Đăng xuất', () => {
  test('đăng xuất xong không dùng lại được phiên cũ', async () => {
    await insertUser({ username: 'alice' });
    const { cookie, csrf } = await loginOk('alice');

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf);
    assert.equal(res.status, 204);
    assert.match([res.headers['set-cookie']].flat().join(';'), /chatio_sid=;/);

    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
    const { rows } = await pool.query('SELECT revoked_at FROM sessions');
    assert.ok(rows[0].revoked_at);
  });

  test('sai CSRF token → 403, phiên vẫn còn', async () => {
    await insertUser({ username: 'alice' });
    const { cookie } = await loginOk('alice');

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', 'forged');
    assert.equal(res.status, 403);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);
  });

  test('chỉ thu hồi phiên hiện tại, phiên ở máy khác vẫn còn', async () => {
    await insertUser({ username: 'alice' });
    const a = await loginOk('alice');
    const b = await loginOk('alice');

    await request(app).post('/api/auth/logout').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', b.cookie)).status, 200);
  });
});

describe('Đổi mật khẩu', () => {
  test('đổi thành công → thu hồi mọi phiên, đăng nhập lại bằng mật khẩu mới', async () => {
    await insertUser({ username: 'alice', mustChangePassword: true });
    const a = await loginOk('alice');
    const b = await loginOk('alice');

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_USER_PASSWORD });
    assert.equal(res.status, 200);

    assert.equal((await request(app).get('/api/auth/me').set('Cookie', a.cookie)).status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', b.cookie)).status, 401);
    assert.equal((await login('alice')).status, 401);

    const relogin = await loginOk('alice', NEW_USER_PASSWORD);
    assert.equal(relogin.body.user.mustChangePassword, false);
  });

  test('sai mật khẩu hiện tại → 401, mật khẩu không đổi', async () => {
    await insertUser({ username: 'alice' });
    const { cookie, csrf } = await loginOk('alice');

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'not-the-password-123', newPassword: NEW_USER_PASSWORD });
    assert.equal(res.status, 401);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);
  });
});
