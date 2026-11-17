import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { app, pool, resetDatabase, insertUser, sessionCookieFrom, PASSWORD } from './helpers.js';

beforeEach(resetDatabase);
after(() => pool.end());

const user = async (username, role = 'user') => {
  const id = await insertUser({ username, role });
  const login = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id, cookie: sessionCookieFrom(login), csrf: login.body.csrfToken };
};
const postAs = (u, url, data, csrf = u.csrf) => {
  const r = request(app).post(url).set('Cookie', u.cookie);
  if (csrf !== null) r.set('X-CSRF-Token', csrf);
  return r.send(data);
};
const getAs = (u, url) => request(app).get(url).set('Cookie', u.cookie);
const direct = (u, peer) => postAs(u, '/api/conversations/direct', { peerUserId: peer.id });
const send = (u, id, text, msgId = randomUUID(), extra = {}) =>
  postAs(u, `/api/conversations/${id}/messages`, { conversationId: id, clientMsgId: msgId, bodyText: text, ...extra });
const count = async (table) => {
  // table chỉ là literal trong tập test, không phải dữ liệu gửi từ client.
  assert.ok(['conversations', 'conversation_members', 'direct_conversation_pairs', 'messages'].includes(table));
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
};
const setup = async () => {
  const alice = await user('alice');
  const bob = await user('bob');
  const conversation = (await direct(alice, bob)).body.conversation;
  return { alice, bob, conversation };
};

describe('Task 6A: tạo chat riêng và danh sách', () => {
  test('tạo chat riêng, có đúng hai thành viên, lưu 1 hội thoại', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const res = await direct(alice, bob);
    assert.equal(res.status, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.conversation.type, 'direct');
    assert.deepEqual(res.body.conversation.members.map(x => x.userId).sort(), [alice.id, bob.id].sort());
    assert.equal(await count('conversations'), 1);
    assert.equal(await count('conversation_members'), 2);
    assert.equal(await count('direct_conversation_pairs'), 1);
  });

  test('tạo lại theo thứ tự ngược trả chat cũ (200)', async () => {
    const { alice, bob, conversation } = await setup();
    const r = await direct(bob, alice);
    assert.equal(r.status, 200);
    assert.equal(r.body.created, false);
    assert.equal(r.body.conversation.id, conversation.id);
    assert.equal(await count('conversations'), 1);
  });

  test('12 yêu cầu đồng thời vẫn một cặp chat', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      direct(i % 2 ? alice : bob, i % 2 ? bob : alice)));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 200).length, 11);
    assert.equal(new Set(responses.map(r => r.body.conversation?.id)).size, 1);
    assert.equal(await count('conversations'), 1);
    assert.equal(await count('conversation_members'), 2);
  });

  test('lỗi tạo thành viên rollback luôn hội thoại và pair', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    await pool.query('ALTER TABLE conversation_members ADD CONSTRAINT test6a_no_member CHECK (FALSE) NOT VALID');
    try {
      const r = await direct(alice, bob);
      assert.equal(r.status, 500);
      assert.equal(await count('conversations'), 0);
      assert.equal(await count('conversation_members'), 0);
      assert.equal(await count('direct_conversation_pairs'), 0);
      assert.ok(!JSON.stringify(r.body).includes('test6a_no_member'));
    } finally {
      await pool.query('ALTER TABLE conversation_members DROP CONSTRAINT test6a_no_member');
    }
  });

  test('không tạo chat với chính mình, UUID sai, người bị khóa/không tồn tại', async () => {
    const alice = await user('alice');
    const locked = await insertUser({ username: 'locked', status: 'locked' });
    assert.equal((await postAs(alice, '/api/conversations/direct', { peerUserId: alice.id })).status, 400);
    assert.equal((await postAs(alice, '/api/conversations/direct', { peerUserId: "1'; DROP TABLE users; --" })).status, 400);
    assert.equal((await postAs(alice, '/api/conversations/direct', { peerUserId: locked })).status, 404);
    assert.equal((await postAs(alice, '/api/conversations/direct', { peerUserId: randomUUID() })).status, 404);
    assert.equal(await count('conversations'), 0);
  });

  test('GET danh sách chỉ trả chat của chính mình', async () => {
    const { alice, bob, conversation } = await setup();
    const eve = await user('eve');
    const one = await getAs(alice, '/api/conversations');
    const two = await getAs(bob, '/api/conversations');
    const outsider = await getAs(eve, '/api/conversations');
    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal(one.body.conversations.length, 1);
    assert.equal(one.body.conversations[0].id, conversation.id);
    assert.deepEqual(outsider.body.conversations, []);
    assert.equal(outsider.status, 200);
  });

  test('admin không tham gia không thể GET metadata chat riêng', async () => {
    const { conversation } = await setup();
    const admin = await user('admin', 'admin');
    const third = await user('third');
    for (const u of [admin, third]) {
      const r = await getAs(u, `/api/conversations/${conversation.id}`);
      assert.equal(r.status, 403);
    }
    const { rows } = await pool.query("SELECT metadata_redacted FROM audit_logs WHERE event_type='ACCESS_DENIED'");
    assert.ok(rows.length >= 2);
  });
});

describe('Task 6A: gửi tin và idempotency', () => {
  test('gửi tin lưu DB rồi mới trả 201; người nhận có thể gửi', async () => {
    const { alice, bob, conversation } = await setup();
    const a = await send(alice, conversation.id, 'Xin chào');
    const b = await send(bob, conversation.id, 'Chào bạn!');
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.message.senderId, alice.id);
    assert.equal(a.body.message.bodyText, 'Xin chào');
    assert.ok(a.body.message.createdAt);
    assert.equal(await count('messages'), 2);
  });

  test('cùng clientMsgId trả đúng tin cũ và không tăng số tin', async () => {
    const { alice, conversation } = await setup();
    const msgId = randomUUID();
    const first = await send(alice, conversation.id, 'hello', msgId);
    const retry = await send(alice, conversation.id, 'hello', msgId);
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.created, false);
    assert.equal(retry.body.message.id, first.body.message.id);
    assert.equal(await count('messages'), 1);
  });

  test('clientMsgId cũ dùng cho nội dung hoặc hội thoại khác -> 409', async () => {
    const { alice, conversation } = await setup();
    const other = await user('other');
    const second = (await direct(alice, other)).body.conversation;
    const id = randomUUID();
    assert.equal((await send(alice, conversation.id, 'hello', id)).status, 201);
    assert.equal((await send(alice, conversation.id, 'changed', id)).status, 409);
    assert.equal((await send(alice, second.id, 'hello', id)).status, 409);
    assert.equal(await count('messages'), 1);
  });

  test('hai request gửi đồng thời cùng clientMsgId vẫn một tin', async () => {
    const { alice, conversation } = await setup();
    const id = randomUUID();
    const res = await Promise.all(Array.from({ length: 6 }, () => send(alice, conversation.id, 'once', id)));
    assert.equal(res.filter(x => x.status === 201).length, 1);
    assert.equal(res.filter(x => x.status === 200).length, 5);
    assert.equal(await count('messages'), 1);
  });

  test('không tin sender_id, senderId, role do client giả mạo', async () => {
    const { alice, bob, conversation } = await setup();
    const r = await send(alice, conversation.id, 'test', randomUUID(), {
      sender_id: bob.id, senderId: bob.id, role: 'admin',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.message.senderId, alice.id);
  });

  test('văn bản HTML/script và chuỗi SQL được lưu nguyên văn, không thực thi', async () => {
    const { alice, conversation } = await setup();
    const html = `<img src=x onerror="alert(1)"><script>alert(1)</script>`;
    const injection = "'); DROP TABLE users; --";
    const a = await send(alice, conversation.id, html);
    const b = await send(alice, conversation.id, injection);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(a.body.message.bodyText, html);
    assert.equal(b.body.message.bodyText, injection);
    const { rows } = await pool.query('SELECT body_text FROM messages ORDER BY created_at');
    assert.deepEqual(rows.map(x => x.body_text), [html, injection]);
    assert.ok((await pool.query('SELECT 1 FROM users LIMIT 1')).rows.length > 0);
  });

  test('chặn trống, toàn khoảng trắng, quá 4000, sai kiểu, ID sai', async () => {
    const { alice, conversation } = await setup();
    for (const value of ['', '   \t\n', 'x'.repeat(4001), 123, null, ['hello'], {}]) {
      const r = await send(alice, conversation.id, value);
      assert.equal(r.status, 400, JSON.stringify(r.body));
    }
    assert.equal((await send(alice, conversation.id, 'valid', 'not-uuid')).status, 400);
    assert.equal((await postAs(alice, `/api/conversations/${conversation.id}/messages`, {
      conversationId: randomUUID(), clientMsgId: randomUUID(), bodyText: 'text',
    })).status, 400);
    assert.equal(await count('messages'), 0);
  });

  test('chấp nhận đúng 4000 ký tự Unicode; 4001 ký tự bị từ chối', async () => {
    const { alice, conversation } = await setup();
    assert.equal((await send(alice, conversation.id, '😀'.repeat(4000))).status, 201);
    assert.equal((await send(alice, conversation.id, '😀'.repeat(4001))).status, 400);
  });

  test('chặn body quá giới hạn request 16kb bằng middleware', async () => {
    const { alice, conversation } = await setup();
    const r = await send(alice, conversation.id, 'x'.repeat(34000));
    assert.equal(r.status, 413);
    assert.equal(await count('messages'), 0);
  });

  test('lỗi INSERT/COMMIT không báo thành công, không lưu dữ liệu', async () => {
    const { alice, conversation } = await setup();
    await pool.query('ALTER TABLE messages ADD CONSTRAINT test6a_no_message CHECK (FALSE) NOT VALID');
    try {
      const r = await send(alice, conversation.id, 'Should not save');
      assert.equal(r.status, 500);
      assert.equal(await count('messages'), 0);
      assert.ok(!JSON.stringify(r.body).includes('test6a_no_message'));
    } finally {
      await pool.query('ALTER TABLE messages DROP CONSTRAINT test6a_no_message');
    }
  });

  test('chặn từ tin 31 / 60 giây; retry cũ vẫn hợp lệ', async () => {
    const { alice, conversation } = await setup();
    const ids = Array.from({ length: 31 }, () => randomUUID());
    for (let i = 0; i < 30; i++) {
      const r = await send(alice, conversation.id, `tin-${i}`, ids[i]);
      assert.equal(r.status, 201, `message ${i}: ${JSON.stringify(r.body)}`);
    }
    const extra = await send(alice, conversation.id, '31', ids[30]);
    assert.equal(extra.status, 429);
    assert.ok(extra.headers['retry-after']);
    assert.equal((await send(alice, conversation.id, 'tin-0', ids[0])).status, 200);
    assert.equal(await count('messages'), 30);
  });

  test('30 yêu cầu đồng thời + một yêu cầu phải giữ tổng <= 30', async () => {
    const { alice, conversation } = await setup();
    const rs = await Promise.all(Array.from({ length: 34 }, (_, i) =>
      send(alice, conversation.id, `simultaneous-${i}`)));
    assert.equal(rs.filter(r => r.status === 201).length, 30);
    assert.equal(rs.filter(r => r.status === 429).length, 4);
    assert.equal(await count('messages'), 30);
  });
});

describe('Task 6A: kiểm tra quyền và phiên', () => {
  test('chưa đăng nhập không xem/tạo/gửi được', async () => {
    const { conversation } = await setup();
    assert.equal((await request(app).get('/api/conversations')).status, 401);
    assert.equal((await request(app).get(`/api/conversations/${conversation.id}`)).status, 401);
    assert.equal((await request(app).post('/api/conversations/direct').send({ peerUserId: randomUUID() })).status, 401);
    assert.equal((await request(app).post(`/api/conversations/${conversation.id}/messages`).send({ clientMsgId: randomUUID(), bodyText: 'x' })).status, 401);
  });

  test('thiếu hoặc sai CSRF -> 403 trên cả hai API POST', async () => {
    const { alice, bob, conversation } = await setup();
    for (const route of [
      ['/api/conversations/direct', { peerUserId: bob.id }],
      [`/api/conversations/${conversation.id}/messages`, { clientMsgId: randomUUID(), bodyText: 'hey' }],
    ]) {
      assert.equal((await postAs(alice, route[0], route[1], null)).status, 403);
      assert.equal((await postAs(alice, route[0], route[1], 'invalid-csrf')).status, 403);
    }
  });

  test('đổi conversationId không vượt quyền; admin ngoài nhóm cũng bị chặn', async () => {
    const { conversation } = await setup();
    const third = await user('third');
    const admin = await user('admin', 'admin');
    for (const u of [third, admin]) {
      assert.equal((await send(u, conversation.id, 'spy')).status, 403);
      assert.equal((await getAs(u, `/api/conversations/${conversation.id}`)).status, 403);
    }
    assert.equal(await count('messages'), 0);
  });

  test('phiên hết hạn hoặc tài khoản bị khóa sau login không thể gửi', async () => {
    const { alice, conversation } = await setup();
    await pool.query('UPDATE sessions SET last_activity_at = now() - interval \'16 minutes\' WHERE user_id = $1', [alice.id]);
    assert.equal((await send(alice, conversation.id, 'expired')).status, 401);
    const bob = await user('newbob');
    const ab = (await direct(bob, await user('other'))).body.conversation;
    await pool.query("UPDATE users SET status='locked' WHERE id=$1", [bob.id]);
    assert.equal((await send(bob, ab.id, 'locked')).status, 401);
  });

  test('nếu thành viên bị xóa trước khi lưu, từ chối gửi', async () => {
    const { alice, conversation } = await setup();
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'UPDATE conversation_members SET left_at = clock_timestamp() WHERE conversation_id=$1 AND user_id=$2',
        [conversation.id, alice.id]
      );
      const pending = send(alice, conversation.id, 'must-not-save').then(r => r);
      await new Promise(resolve => setTimeout(resolve, 50));
      await blocker.query('COMMIT');
      const r = await pending;
      assert.equal(r.status, 403);
      assert.equal(await count('messages'), 0);
    } finally {
      try { await blocker.query('ROLLBACK'); } catch { /* transaction already finished */ }
      blocker.release();
    }
  });

  test('chưa tích hợp Task 6B: group dù là thành viên cũng không gửi được', async () => {
    const alice = await user('alice');
    const { rows } = await pool.query(
      "INSERT INTO conversations (type, created_by) VALUES ('group',$1) RETURNING id", [alice.id]
    );
    await pool.query('INSERT INTO conversation_members (conversation_id,user_id) VALUES ($1,$2)', [rows[0].id, alice.id]);
    const res = await send(alice, rows[0].id, 'not yet');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'GROUP_NOT_ENABLED');
    assert.equal(await count('messages'), 0);
  });
});
