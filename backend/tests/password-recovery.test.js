import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  pool,
  resetDatabase,
  insertUser,
} from './helpers.js';

import { config } from '../src/config.js';
import { resetRecoveryLimiter } from '../src/lib/recoveryLimiter.js';

import {
  buildResetUrl,
  FORGOT_PASSWORD_MESSAGE,
  requestPasswordReset,
} from '../src/services/passwordRecovery.js';

import { createFakeMailer } from './fakeMailer.js';

describe('Task 5B: Password Recovery', () => {
  let userId;
  let fakeMailer;

  beforeEach(async () => {
    await resetDatabase();
    resetRecoveryLimiter();

    fakeMailer = createFakeMailer();

    userId = await insertUser({
      username: 'alice',
    });

    await pool.query(
      `UPDATE users
       SET email = $2, email_verified_at = now()
       WHERE id = $1`,
      [userId, 'alice@example.com']
    );
  });

  it('Link reset sử dụng HTTPS và domain cấu hình', () => {
    const url = new URL(buildResetUrl('test-token'));

    assert.equal(url.protocol, 'https:');
    assert.equal(url.origin, config.appPublicUrl);
    assert.equal(url.pathname, '/reset-password');
  });

  it('Thông báo forgot-password đúng yêu cầu', () => {
    assert.equal(
      FORGOT_PASSWORD_MESSAGE,
      'Nếu tài khoản tồn tại và có email đã xác minh, hướng dẫn đặt lại mật khẩu sẽ được gửi.'
    );
  });

  it('Tài khoản có email xác minh nhận email khôi phục', async () => {
    await requestPasswordReset({
      usernameOrEmail: 'alice',
      ip: '127.0.0.1',
      emailMailer: fakeMailer,
    });

    assert.equal(fakeMailer.messages.length, 1);
    assert.equal(
      fakeMailer.messages[0].to,
      'alice@example.com'
    );
  });

  it('Email chưa xác minh không nhận email khôi phục', async () => {
    await pool.query(
      'UPDATE users SET email_verified_at = NULL WHERE id = $1',
      [userId]
    );

    await requestPasswordReset({
      usernameOrEmail: 'alice',
      ip: '127.0.0.1',
      emailMailer: fakeMailer,
    });

    assert.equal(fakeMailer.messages.length, 0);
  });

  it('Tài khoản không tồn tại không gửi email', async () => {
    await requestPasswordReset({
      usernameOrEmail: 'unknown-user',
      ip: '127.0.0.1',
      emailMailer: fakeMailer,
    });

    assert.equal(fakeMailer.messages.length, 0);
  });

  it('Tài khoản bị khóa không nhận email khôi phục', async () => {
    await pool.query(
      `UPDATE users SET status = 'locked' WHERE id = $1`,
      [userId]
    );

    await requestPasswordReset({
      usernameOrEmail: 'alice',
      ip: '127.0.0.1',
      emailMailer: fakeMailer,
    });

    assert.equal(fakeMailer.messages.length, 0);
  });

  it('Lỗi gửi email được xử lý an toàn', async () => {
    fakeMailer.setFailure(true);

    await assert.doesNotReject(
      requestPasswordReset({
        usernameOrEmail: 'alice',
        ip: '127.0.0.1',
        emailMailer: fakeMailer,
      })
    );
  });
});

after(async () => {
  await pool.end();
});