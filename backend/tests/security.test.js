import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { PASSWORD, app, insertUser, pool, resetDatabase, sessionCookieFrom } from './helpers.js';

beforeEach(resetDatabase);
after(() => pool.end());

const countSessions = async () =>
  Number((await pool.query('SELECT count(*) FROM sessions')).rows[0].count);

const snapshotUsers = async () =>
  (
    await pool.query(
      `SELECT id, username, global_role, status, password_hash, must_change_password, updated_at
         FROM users ORDER BY username`
    )
  ).rows;

/** Ghi lại mọi câu SQL gửi tới PostgreSQL trong lúc chạy fn. */
const captureQueries = async (fn) => {
  const captured = [];
  const original = pool.query;
  pool.query = function (text, values, ...rest) {
    captured.push({ text: typeof text === 'string' ? text : text?.text, values });
    return original.call(this, text, values, ...rest);
  };
  try {
    await fn();
  } finally {
    pool.query = original;
  }
  return captured;
};

/*
 * TC42 — SQL Injection vào username khi đăng nhập (SEC-04).
 * Mỗi payload đều ≤ 50 ký tự để thực sự đi tới truy vấn CSDL
 * (username dài hơn 50 ký tự bị từ chối trước khi truy vấn).
 */
describe('TC42 – SQL Injection vào username khi đăng nhập', () => {
  const PAYLOADS = [
    `' OR '1'='1' --`,
    `' OR 1=1 --`,
    `admin'--`,
    `admin' OR '1'='1`,
    `' UNION SELECT * FROM users --`,
    `'; DROP TABLE users; --`,
    `'; UPDATE users SET global_role='admin'; --`,
    `'; DELETE FROM sessions; --`,
  ];

  const seed = async () => {
    await insertUser({ username: 'admin', role: 'admin' });
    await insertUser({ username: 'alice' });
  };

  test('mọi payload → 401 giống hệt sai mật khẩu, không cấp phiên', async () => {
    await seed();
    const baseline = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrong-password-123456' });
    assert.equal(baseline.status, 401);

    for (const username of PAYLOADS) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username, password: 'anything-at-all-123' });
      assert.equal(res.status, 401, `payload: ${username}`);
      assert.deepEqual(res.body, baseline.body, `payload: ${username}`);
      assert.equal(sessionCookieFrom(res), undefined, `payload: ${username}`);
    }
    assert.equal(await countSessions(), 0);
  });

  test('payload kèm mật khẩu đúng của admin cũng không đăng nhập được', async () => {
    await seed();
    for (const username of [`admin'--`, `admin' --`, `' OR username='admin' --`]) {
      const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
      assert.equal(res.status, 401, `payload: ${username}`);
    }
    assert.equal(await countSessions(), 0);
  });

  test('payload SQL trong mật khẩu → 401 (mật khẩu không bao giờ đi vào SQL)', async () => {
    await seed();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: `' OR '1'='1' --` });
    assert.equal(res.status, 401);
    assert.equal(await countSessions(), 0);
  });

  test('dữ liệu không bị thay đổi: users giữ nguyên, bảng vẫn còn, role không bị nâng', async () => {
    await seed();
    const before = await snapshotUsers();

    for (const username of PAYLOADS) {
      await request(app).post('/api/auth/login').send({ username, password: 'anything-at-all-123' });
    }

    assert.deepEqual(await snapshotUsers(), before);
    const { rows } = await pool.query(
      `SELECT to_regclass('public.users') AS users, to_regclass('public.sessions') AS sessions`
    );
    assert.ok(rows[0].users && rows[0].sessions, 'bảng users/sessions phải còn');
    const alice = before.find((u) => u.username === 'alice');
    assert.equal(alice.global_role, 'user');
  });

  test('truy vấn dùng tham số: payload nằm trong values, không nằm trong câu SQL', async () => {
    await seed();
    const payload = `' OR '1'='1' --`;
    const queries = await captureQueries(() =>
      request(app).post('/api/auth/login').send({ username: payload, password: 'anything-at-all-123' })
    );

    const lookup = queries.find((q) => /FROM users WHERE username = \$1/.test(q.text));
    assert.ok(lookup, 'phải có truy vấn tìm user theo username = $1');
    assert.deepEqual(lookup.values, [payload]);
    for (const q of queries) {
      assert.ok(!q.text.includes(payload), `payload bị ghép vào SQL: ${q.text}`);
    }
  });

  test('username tìm đúng nguyên văn: payload không khớp user thật dù CSDL có dữ liệu', async () => {
    await seed();
    // Nếu SQL bị ghép chuỗi, "' OR '1'='1' --" sẽ trả về dòng đầu tiên (admin).
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [`' OR '1'='1' --`]);
    assert.equal(rows.length, 0);
  });
});

/*
 * TC56 — Trang web khác gửi yêu cầu đăng nhập (login CSRF, ACC-04).
 * Mô phỏng các header trình duyệt tự gắn khi trang https://evil.example gửi request.
 * Kiểm thử bằng trình duyệt thật: xem docs/testing/tc56-login-csrf/.
 */
describe('TC56 – trang web khác gửi yêu cầu đăng nhập (login CSRF)', () => {
  const EVIL = 'https://evil.example';

  const expectBlocked = async (res, label) => {
    assert.equal(res.status, 403, label);
    assert.equal(res.body.error.code, 'CROSS_SITE_REQUEST', label);
    assert.equal(sessionCookieFrom(res), undefined, label);
  };

  test('form HTML tự submit từ trang khác (urlencoded) → 403, không cấp phiên', async () => {
    await insertUser({ username: 'attacker' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', EVIL)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Sec-Fetch-Mode', 'navigate')
      .type('form')
      .send({ username: 'attacker', password: PASSWORD });
    await expectBlocked(res, 'form urlencoded');
    assert.equal(await countSessions(), 0);
  });

  test('fetch no-cors text/plain chứa JSON từ trang khác → 403', async () => {
    await insertUser({ username: 'attacker' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', EVIL)
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ username: 'attacker', password: PASSWORD }));
    await expectBlocked(res, 'text/plain');
    assert.equal(await countSessions(), 0);
  });

  test('JSON đúng mật khẩu nhưng Origin lạ → 403 (kể cả trình duyệt không gửi Sec-Fetch-Site)', async () => {
    await insertUser({ username: 'attacker' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', EVIL)
      .send({ username: 'attacker', password: PASSWORD });
    await expectBlocked(res, 'origin lạ');
    assert.equal(await countSessions(), 0);
  });

  test('Origin: null (file://, iframe sandbox) → 403', async () => {
    await insertUser({ username: 'attacker' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'null')
      .send({ username: 'attacker', password: PASSWORD });
    await expectBlocked(res, 'origin null');
  });

  test('form không có Origin/Sec-Fetch (trình duyệt cũ) vẫn bị chặn vì không phải JSON → 415', async () => {
    await insertUser({ username: 'attacker' });
    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ username: 'attacker', password: PASSWORD });
    assert.equal(res.status, 415);
    assert.equal(sessionCookieFrom(res), undefined);
    assert.equal(await countSessions(), 0);
  });

  test('lần bị chặn được ghi ACCESS_DENIED vào nhật ký, không chứa mật khẩu', async () => {
    await insertUser({ username: 'attacker' });
    await request(app)
      .post('/api/auth/login')
      .set('Origin', EVIL)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ username: 'attacker', password: PASSWORD });

    const { rows } = await pool.query(
      `SELECT event_type, outcome, metadata_redacted FROM audit_logs`
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, 'ACCESS_DENIED');
    assert.match(rows[0].metadata_redacted, /evil\.example/);
    assert.ok(!rows[0].metadata_redacted.includes(PASSWORD));
  });

  test('đối chứng: frontend hợp lệ (http://localhost:5173 qua Vite) đăng nhập được', async () => {
    await insertUser({ username: 'alice' });
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ username: 'alice', password: PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(sessionCookieFrom(res));
  });

  test('đối chứng: cùng origin với backend đăng nhập được', async () => {
    await insertUser({ username: 'alice' });
    const agent = request(app);
    const res = await agent
      .post('/api/auth/login')
      .set('Host', 'chat.local:3000')
      .set('Origin', 'http://chat.local:3000')
      .send({ username: 'alice', password: PASSWORD });
    assert.equal(res.status, 200);
  });

  test('logout từ trang khác cũng bị chặn (lớp bảo vệ áp dụng mọi POST)', async () => {
    await insertUser({ username: 'alice' });
    const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: PASSWORD });
    const cookie = sessionCookieFrom(login);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', EVIL)
      .set('X-CSRF-Token', login.body.csrfToken);
    assert.equal(res.status, 403);
    assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 200);
  });
});
