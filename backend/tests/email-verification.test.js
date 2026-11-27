import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, insertUser } from './helpers.js';
import { normalizeEmail } from '../src/lib/emailAddress.js';
import { generateToken, hashToken } from '../src/lib/emailTokens.js';
import { sendVerification, verifyEmail } from '../src/services/emailVerification.js';
import { createFakeMailer } from './fakeMailer.js';

describe('Task 5B: Email Verification', () => {
  let userId;
  let fakeMailer;

  beforeEach(async () => {
    await resetDatabase();

    fakeMailer = createFakeMailer();

    userId = await insertUser({
      username: 'user1',
    });

    await pool.query(
      'UPDATE users SET email = $2 WHERE id = $1',
      [userId, 'user1@example.com']
    );
  });

  it('Chuẩn hóa email', () => {
    assert.equal(
      normalizeEmail('  User@Example.com  '),
      'user@example.com'
    );
  });

  it('Từ chối email không hợp lệ', () => {
    assert.equal(normalizeEmail('invalid-email'), null);
    assert.equal(normalizeEmail(''), null);
    assert.equal(normalizeEmail(null), null);
  });

  it('Token có độ dài 32 byte', () => {
    assert.equal(
      Buffer.from(generateToken(), 'base64url').length,
      32
    );
  });

  it('Hash token có định dạng SHA-256', () => {
    assert.match(
      hashToken(generateToken()),
      /^[a-f0-9]{64}$/
    );
  });

  it('Email mới chưa được xác minh', async () => {
    const { rows } = await pool.query(
      'SELECT email_verified_at FROM users WHERE id = $1',
      [userId]
    );

    assert.equal(rows[0].email_verified_at, null);
  });

  it('Gửi email xác minh bằng fake mailer', async () => {
    const result = await sendVerification({
      userId,
      ip: '127.0.0.1',
      emailMailer: fakeMailer,
    });

    assert.equal(result, true);
    assert.equal(fakeMailer.messages.length, 1);
    assert.equal(
      fakeMailer.messages[0].to,
      'user1@example.com'
    );
  });

  it('Fake mailer hỗ trợ mô phỏng lỗi', async () => {
    fakeMailer.setFailure(true);

    await assert.rejects(
      fakeMailer.sendMail({
        to: 'user1@example.com',
        subject: 'Test',
        text: 'Test',
      })
    );
  });

  it('Token hợp lệ xác minh email thành công', async () => {
    const token = generateToken();

    await pool.query(
      `INSERT INTO email_verification_tokens
       (user_id, email, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes')`,
      [userId, 'user1@example.com', hashToken(token)]
    );

    const result = await verifyEmail({
      userId,
      token,
      ip: '127.0.0.1',
    });

    assert.equal(result, true);

    const { rows } = await pool.query(
      'SELECT email_verified_at FROM users WHERE id = $1',
      [userId]
    );

    assert.ok(rows[0].email_verified_at);
  });
});

after(async () => {
  await pool.end();
});