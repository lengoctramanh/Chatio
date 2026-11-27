import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  resetDatabase,
  insertUser,
  PASSWORD,
} from './helpers.js';

import {
  generateRecoveryCodes,
  hashRecoveryCode,
  regenerateRecoveryCodes,
  countRemainingRecoveryCodes,
} from '../src/services/adminRecovery.js';

import { createFakeMailer } from './fakeMailer.js';

describe('Task 5B: Admin Recovery', () => {
  let adminId;
  let fakeMailer;

  beforeEach(async () => {
    await resetDatabase();

    fakeMailer = createFakeMailer();

    adminId = await insertUser({
      username: 'admin',
      role: 'admin',
    });

    await pool.query(
      `UPDATE users
       SET email = $2, email_verified_at = now()
       WHERE id = $1`,
      [adminId, 'admin@example.com']
    );
  });

  it('Sinh đủ 10 mã ngẫu nhiên không trùng nhau', () => {
    const codes = generateRecoveryCodes();

    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);

    for (const code of codes) {
      assert.match(code, /^[a-f0-9]{32}$/);
    }
  });

  it('Hash có định dạng SHA-256', () => {
    const code = generateRecoveryCodes()[0];

    assert.match(hashRecoveryCode(code), /^[a-f0-9]{64}$/);
    assert.notEqual(hashRecoveryCode(code), code);
  });

  it('Chuẩn hóa mã trước khi băm', () => {
    const code = generateRecoveryCodes()[0];

    assert.equal(
      hashRecoveryCode(code),
      hashRecoveryCode(` ${code.toUpperCase()} `)
    );
  });

  it('Admin đủ điều kiện được cấp 10 mã', async () => {
    const codes = await regenerateRecoveryCodes({
      userId: adminId,
      currentPassword: PASSWORD,
      emailMailer: fakeMailer,
    });

    assert.equal(codes.length, 10);
    assert.equal(await countRemainingRecoveryCodes(adminId), 10);
  });

  it('Mật khẩu hiện tại không đúng thì từ chối cấp mã', async () => {
    const result = await regenerateRecoveryCodes({
      userId: adminId,
      currentPassword: 'incorrect-password',
      emailMailer: fakeMailer,
    });

    assert.equal(result, null);
    assert.equal(await countRemainingRecoveryCodes(adminId), 0);
  });

  it('Admin chưa xác minh email không được cấp mã', async () => {
    await pool.query(
      'UPDATE users SET email_verified_at = NULL WHERE id = $1',
      [adminId]
    );

    const result = await regenerateRecoveryCodes({
      userId: adminId,
      currentPassword: PASSWORD,
      emailMailer: fakeMailer,
    });

    assert.equal(result, null);
  });

  it('Admin chưa đổi mật khẩu lần đầu không được cấp mã', async () => {
    await pool.query(
      'UPDATE users SET must_change_password = TRUE WHERE id = $1',
      [adminId]
    );

    const result = await regenerateRecoveryCodes({
      userId: adminId,
      currentPassword: PASSWORD,
      emailMailer: fakeMailer,
    });

    assert.equal(result, null);
  });

  it('Tạo bộ mã mới vẫn chỉ còn 10 mã hiệu lực', async () => {
    const options = {
      userId: adminId,
      currentPassword: PASSWORD,
      emailMailer: fakeMailer,
    };

    await regenerateRecoveryCodes(options);
    await regenerateRecoveryCodes(options);

    assert.equal(await countRemainingRecoveryCodes(adminId), 10);
  });

  it('Gửi cảnh báo khi cấp bộ mã mới', async () => {
    const codes = await regenerateRecoveryCodes({
      userId: adminId,
      currentPassword: PASSWORD,
      emailMailer: fakeMailer,
    });

    assert.equal(fakeMailer.messages.length, 1);

    for (const code of codes) {
      assert.ok(
        !JSON.stringify(fakeMailer.messages).includes(code)
      );
    }
  });
});

after(async () => {
  await pool.end();
});