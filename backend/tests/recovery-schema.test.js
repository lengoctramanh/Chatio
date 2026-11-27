import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './helpers.js';

describe('Task 5B: Recovery Schema', () => {
  it('Có bảng password_reset_tokens', async () => {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.password_reset_tokens') AS name
    `);

    assert.equal(rows[0].name, 'password_reset_tokens');
  });

  it('Có bảng admin_recovery_codes', async () => {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.admin_recovery_codes') AS name
    `);

    assert.equal(rows[0].name, 'admin_recovery_codes');
  });

  it('Có index thời hạn token reset', async () => {
    const { rows } = await pool.query(`
      SELECT to_regclass('public.password_reset_expiry_idx') AS name
    `);

    assert.equal(rows[0].name, 'password_reset_expiry_idx');
  });
});

after(async () => {
  await pool.end();
});