import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, resetDatabase, insertUser } from './helpers.js';
import { generateToken, hashToken } from '../src/lib/emailTokens.js';
import { invalidateResetTokens } from '../src/services/passwordRecovery.js';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  invalidateRecoveryCodes,
  countRemainingRecoveryCodes,
} from '../src/services/adminRecovery.js';

describe('Task 5B: Recovery Invalidation', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('Thu hồi toàn bộ token reset của tài khoản', async () => {
    const userId = await insertUser({ username: 'user1' });

    await pool.query(
      `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '15 minutes')`,
      [userId, hashToken(generateToken())]
    );

    assert.equal(await invalidateResetTokens(userId), 1);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM password_reset_tokens
       WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );

    assert.equal(rows[0].total, 0);
  });

  it('Thu hồi toàn bộ bộ mã khôi phục admin', async () => {
    const userId = await insertUser({
      username: 'admin',
      role: 'admin',
    });

    for (const code of generateRecoveryCodes()) {
      await pool.query(
        `INSERT INTO admin_recovery_codes (user_id, code_hash)
         VALUES ($1, $2)`,
        [userId, hashRecoveryCode(code)]
      );
    }

    assert.equal(await countRemainingRecoveryCodes(userId), 10);
    assert.equal(await invalidateRecoveryCodes(userId), 10);
    assert.equal(await countRemainingRecoveryCodes(userId), 0);
  });
});

after(async () => {
  await pool.end();
});