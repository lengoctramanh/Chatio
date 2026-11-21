import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';
import request from 'supertest';
import { assertCanReadConversationContent } from '../src/services/conversationPermissions.js';
import { PASSWORD, app, insertUser, pool, resetDatabase, sessionCookieFrom } from './helpers.js';

beforeEach(resetDatabase);
after(() => pool.end());

const user = async (username, role = 'user') => {
  const id = await insertUser({ username, role });
  const login = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { id, username, cookie: sessionCookieFrom(login), csrf: login.body.csrfToken };
};

const postAs = (u, url, data, csrf = u.csrf) => {
  const r = request(app).post(url).set('Cookie', u.cookie);
  if (csrf !== null) r.set('X-CSRF-Token', csrf);
  return r.send(data);
};

const deleteAs = (u, url, csrf = u.csrf) => {
  const r = request(app).delete(url).set('Cookie', u.cookie);
  if (csrf !== null) r.set('X-CSRF-Token', csrf);
  return r;
};

const getAs = (u, url) => request(app).get(url).set('Cookie', u.cookie);

const sendMsg = (u, convId, bodyText, clientMsgId = randomUUID(), extra = {}) =>
  postAs(u, `/api/conversations/${convId}/messages`, {
    conversationId: convId,
    clientMsgId,
    bodyText,
    ...extra,
  });

describe('Task 6B: Tạo và xem nhóm', () => {
  test('tạo nhóm thành công, người tạo là owner và các thành viên được lưu đầy đủ', async () => {
    const owner = await user('owner');
    const bob = await user('bob');
    const charlie = await user('charlie');

    const res = await postAs(owner, '/api/conversations/groups', {
      name: 'Nhóm Đồ Án',
      memberIds: [bob.id, charlie.id],
      ownerId: bob.id,
      memberRole: 'member',
    });

    assert.equal(res.status, 201);
    const conv = res.body.conversation;
    assert.equal(conv.type, 'group');
    assert.equal(conv.name, 'Nhóm Đồ Án');
    assert.equal(conv.createdBy, owner.id);
    assert.equal(conv.members.length, 3);

    const ownerMember = conv.members.find((m) => m.userId === owner.id);
    assert.equal(ownerMember.memberRole, 'owner');
    assert.equal(conv.members.find((m) => m.userId === bob.id).memberRole, 'member');
  });

  test('tạo nhóm lỗi giữa chừng rollback toàn bộ, không để lại nhóm tạo dở', async () => {
    const owner = await user('owner');
    const bob = await user('bob');

    await pool.query('ALTER TABLE conversation_members ADD CONSTRAINT test6b_fail CHECK (FALSE) NOT VALID');
    try {
      const res = await postAs(owner, '/api/conversations/groups', {
        name: 'Nhóm Lỗi',
        memberIds: [bob.id],
      });
      assert.equal(res.status, 500);
      const { rows: convs } = await pool.query('SELECT 1 FROM conversations');
      const { rows: mems } = await pool.query('SELECT 1 FROM conversation_members');
      assert.equal(convs.length, 0);
      assert.equal(mems.length, 0);
    } finally {
      await pool.query('ALTER TABLE conversation_members DROP CONSTRAINT test6b_fail');
    }
  });

  test('từ chối ID sai, trùng thành viên, tài khoản bị khóa hoặc tên rỗng', async () => {
    const owner = await user('owner');
    const bob = await user('bob');
    const locked = await insertUser({ username: 'locked', status: 'locked' });

    assert.equal((await postAs(owner, '/api/conversations/groups', { name: '   ', memberIds: [bob.id] })).status, 400);
    assert.equal((await postAs(owner, '/api/conversations/groups', { name: 'G1', memberIds: [bob.id, bob.id] })).status, 400);
    assert.equal((await postAs(owner, '/api/conversations/groups', { name: 'G1', memberIds: [owner.id] })).status, 400);
    assert.equal((await postAs(owner, '/api/conversations/groups', { name: 'G1', memberIds: [locked] })).status, 400);
    assert.equal((await postAs(owner, '/api/conversations/groups', { name: 'G1', memberIds: [randomUUID()] })).status, 400);
  });

  test('GET /api/conversations hiển thị nhóm đang tham gia; ẩn nhóm sau khi bị xóa', async () => {
    const owner = await user('owner');
    const bob = await user('bob');
    const outsider = await user('outsider');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Team 6B',
      memberIds: [bob.id],
    });
    const groupId = created.body.conversation.id;

    const bobList1 = await getAs(bob, '/api/conversations');
    assert.equal(bobList1.status, 200);
    assert.equal(bobList1.body.conversations.length, 1);
    assert.equal(bobList1.body.conversations[0].id, groupId);
    assert.equal(bobList1.body.conversations[0].name, 'Team 6B');

    const outsiderList = await getAs(outsider, '/api/conversations');
    assert.equal(outsiderList.body.conversations.length, 0);

    await deleteAs(owner, `/api/conversations/${groupId}/members/${bob.id}`);
    const bobList2 = await getAs(bob, '/api/conversations');
    assert.equal(bobList2.body.conversations.length, 0);
  });

  test('admin toàn hệ thống không tham gia bị chặn xem thành viên và thông tin nhóm', async () => {
    const owner = await user('owner');
    const bob = await user('bob');
    const admin = await user('sysadmin', 'admin');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Secret Group',
      memberIds: [bob.id],
    });
    const groupId = created.body.conversation.id;

    assert.equal((await getAs(admin, `/api/conversations/${groupId}`)).status, 403);
    assert.equal((await getAs(admin, `/api/conversations/${groupId}/members`)).status, 403);
    assert.equal((await getAs(bob, `/api/conversations/${groupId}/members`)).status, 200);
  });
});

describe('Task 6B: Quản lý thành viên và concurrency', () => {
  test('chỉ chủ nhóm được thêm/xóa; thành viên thường và admin hệ thống bị từ chối', async () => {
    const owner = await user('owner');
    const member = await user('member');
    const target = await user('target');
    const admin = await user('sysadmin', 'admin');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Group A',
      memberIds: [member.id],
    });
    const groupId = created.body.conversation.id;

    assert.equal((await postAs(member, `/api/conversations/${groupId}/members`, { userId: target.id })).status, 403);
    assert.equal((await postAs(admin, `/api/conversations/${groupId}/members`, { userId: target.id })).status, 403);

    const addRes = await postAs(owner, `/api/conversations/${groupId}/members`, { userId: target.id });
    assert.equal(addRes.status, 201);
    assert.equal(addRes.body.members.length, 3);

    assert.equal((await deleteAs(member, `/api/conversations/${groupId}/members/${target.id}`)).status, 403);
    assert.equal((await deleteAs(admin, `/api/conversations/${groupId}/members/${target.id}`)).status, 403);
    assert.equal((await deleteAs(owner, `/api/conversations/${groupId}/members/${owner.id}`)).status, 400);

    const delRes = await deleteAs(owner, `/api/conversations/${groupId}/members/${target.id}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.body.members.length, 2);

    const { rows: history } = await pool.query(
      'SELECT joined_at, left_at FROM conversation_members WHERE conversation_id = $1 AND user_id = $2',
      [groupId, target.id]
    );
    assert.equal(history.length, 1);
    assert.ok(history[0].left_at !== null);
  });

  test('thêm cùng thành viên 2 lần hoặc đồng thời không tạo bản ghi trùng', async () => {
    const owner = await user('owner');
    const target = await user('target');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Concurrent Add Group',
      memberIds: [],
    });
    const groupId = created.body.conversation.id;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        postAs(owner, `/api/conversations/${groupId}/members`, { userId: target.id })
      )
    );

    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 4);

    const { rows } = await pool.query(
      'SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL',
      [groupId, target.id]
    );
    assert.equal(rows.length, 1);
  });

  test('xóa và thêm lại tạo bản ghi mới với joined_at mới; không đọc được tin trước khi tham gia', async () => {
    const owner = await user('owner');
    const bob = await user('bob');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Rejoin Group',
      memberIds: [bob.id],
    });
    const groupId = created.body.conversation.id;

    const msg1 = await sendMsg(owner, groupId, 'Tin 1 lúc bob có mặt');
    assert.equal(msg1.status, 201);

    await deleteAs(owner, `/api/conversations/${groupId}/members/${bob.id}`);

    await assert.rejects(() => assertCanReadConversationContent(pool, groupId, bob.id), { status: 403 });
    assert.equal((await sendMsg(bob, groupId, 'Bob gửi lén')).status, 403);

    const msg2 = await sendMsg(owner, groupId, 'Tin 2 lúc bob vắng mặt');
    assert.equal(msg2.status, 201);

    const rejoin = await postAs(owner, `/api/conversations/${groupId}/members`, { userId: bob.id });
    assert.equal(rejoin.status, 201);

    const { rows: allRecords } = await pool.query(
      'SELECT joined_at, left_at FROM conversation_members WHERE conversation_id = $1 AND user_id = $2 ORDER BY joined_at ASC',
      [groupId, bob.id]
    );
    assert.equal(allRecords.length, 2);
    assert.ok(allRecords[0].left_at !== null);
    assert.equal(allRecords[1].left_at, null);

    const msg3 = await sendMsg(owner, groupId, 'Tin 3 sau khi bob quay lại');
    assert.equal(msg3.status, 201);

    await assert.rejects(
      () => assertCanReadConversationContent(pool, groupId, bob.id, { messageCreatedAt: msg2.body.message.createdAt }),
      { status: 403 }
    );
    const allowed = await assertCanReadConversationContent(pool, groupId, bob.id, {
      messageCreatedAt: msg3.body.message.createdAt,
    });
    assert.equal(allowed.conversation.id, groupId);
  });
});

describe('Task 6B: Gửi tin nhóm, đồng thời và bảo mật', () => {
  test('gửi tin đồng thời với xóa thành viên không tạo tin trái quyền', async () => {
    const owner = await user('owner');
    const bob = await user('bob');

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Race Group',
      memberIds: [bob.id],
    });
    const groupId = created.body.conversation.id;

    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'UPDATE conversation_members SET left_at = clock_timestamp() WHERE conversation_id = $1 AND user_id = $2',
        [groupId, bob.id]
      );
      const pendingSend = sendMsg(bob, groupId, 'tin chạy đua');
      await new Promise((r) => setTimeout(r, 50));
      await blocker.query('COMMIT');

      const res = await pendingSend;
      assert.equal(res.status, 403);
      const { rows } = await pool.query('SELECT 1 FROM messages WHERE conversation_id = $1', [groupId]);
      assert.equal(rows.length, 0);
    } finally {
      try { await blocker.query('ROLLBACK'); } catch { /* ignore */ }
      blocker.release();
    }
  });

  test('giới hạn 30 tin/phút, chống gửi trùng và lưu văn bản thuần (chống XSS/SQLi) áp dụng cho nhóm', async () => {
    const owner = await user('owner');
    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Spam & XSS Group',
      memberIds: [],
    });
    const groupId = created.body.conversation.id;

    const xssPayload = `<script>alert('xss')</script>'; DROP TABLE messages; --`;
    const dupId = randomUUID();

    const first = await sendMsg(owner, groupId, xssPayload, dupId);
    const retry = await sendMsg(owner, groupId, xssPayload, dupId);
    assert.equal(first.status, 201);
    assert.equal(first.body.message.bodyText, xssPayload);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.created, false);

    for (let i = 1; i < 30; i++) {
      const r = await sendMsg(owner, groupId, `msg-${i}`);
      assert.equal(r.status, 201);
    }
    const rateLimited = await sendMsg(owner, groupId, 'msg-31');
    assert.equal(rateLimited.status, 429);
  });

  test('thiếu CSRF, đổi ID nhóm/user và ghi audit log đầy đủ không lộ bí mật', async () => {
    const owner = await user('owner');
    const bob = await user('bob');
    const hacker = await user('hacker');

    assert.equal((await postAs(owner, '/api/conversations/groups', { name: 'No CSRF', memberIds: [] }, null)).status, 403);

    const created = await postAs(owner, '/api/conversations/groups', {
      name: 'Audit Group',
      memberIds: [bob.id],
    });
    const groupId = created.body.conversation.id;

    assert.equal((await getAs(hacker, `/api/conversations/${groupId}/members`)).status, 403);
    assert.equal((await deleteAs(owner, `/api/conversations/${groupId}/members/${bob.id}`, 'wrong-csrf')).status, 403);

    const { rows: logs } = await pool.query(
      'SELECT event_type, outcome, metadata_redacted FROM audit_logs ORDER BY id'
    );
    const types = logs.map((l) => `${l.event_type}:${l.outcome}`);
    assert.ok(types.includes('GROUP_CREATE:success'));
    assert.ok(types.includes('ACCESS_DENIED:failure'));
    assert.ok(!JSON.stringify(logs).includes(PASSWORD));
  });
});