import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pool, withTransaction } from '../src/db/pool.js';
import { writeAudit } from '../src/lib/audit.js';
import {
  hashPassword,
  validateNewPassword,
} from '../src/lib/passwords.js';
import { revokeAllUserSessions } from '../src/lib/sessions.js';
import {
  USERNAME_PATTERN,
  updatePasswordHash,
} from '../src/models/user.js';
import { mailer } from '../src/services/mailer.js';
import {
  invalidateResetTokens,
} from '../src/services/passwordRecovery.js';

const readTemporaryPassword = async () => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Cần chạy lệnh trong terminal tương tác để nhập mật khẩu ẩn.');
  }

  const hiddenOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

  const input = createInterface({
    input: process.stdin,
    output: hiddenOutput,
    terminal: true,
    historySize: 0,
  });

  const cancellation = new AbortController();
  input.on('SIGINT', () => cancellation.abort());
  input.on('close', () => cancellation.abort());

  const ask = async (prompt) => {
    process.stdout.write(prompt);
    try {
      return await input.question('', { signal: cancellation.signal });
    } finally {
      process.stdout.write('\n');
    }
  };

  try {
    const password = await ask('Mật khẩu tạm: ');
    const validationError = validateNewPassword(password);
    if (validationError) {
      console.error(validationError);
      return null;
    }

    const confirmation = await ask('Nhập lại mật khẩu tạm: ');
    if (confirmation !== password) {
      console.error('Hai lần nhập mật khẩu không khớp.');
      return null;
    }

    return password;
  } finally {
    input.close();
    hiddenOutput.end();
  }
};

const recoverAdmin = (username, passwordHash) =>
  withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, email_verified_at
       FROM users
       WHERE username = $1 AND global_role = 'admin'
       FOR UPDATE`,
      [username],
    );

    const admin = rows[0];
    if (!admin) return null;

    await updatePasswordHash(
      admin.id,
      passwordHash,
      { mustChangePassword: true },
      client,
    );
    await revokeAllUserSessions(admin.id, client);
    await invalidateResetTokens(admin.id, client);

    await writeAudit({
      actorUserId: admin.id,
      eventType: 'ADMIN_PASSWORD_RECOVERY',
      outcome: 'success',
    }, client);

    return {
      email: admin.email_verified_at ? admin.email : null,
    };
  });

const main = async () => {
  const [username, ...extraArgs] = process.argv.slice(2);
  if (!username || extraArgs.length > 0 || !USERNAME_PATTERN.test(username)) {
    console.error('Cách dùng: npm.cmd run reset-password -- <username-admin>');
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('Cần chạy lệnh trong terminal tương tác để nhập mật khẩu ẩn.');
    process.exitCode = 1;
    return;
  }

  const { rowCount } = await pool.query(
    `SELECT id FROM users
     WHERE username = $1 AND global_role = 'admin'`,
    [username],
  );
  if (rowCount === 0) {
    console.error('Không tìm thấy tài khoản admin khớp với username đã nhập.');
    process.exitCode = 1;
    return;
  }

  const password = await readTemporaryPassword();
  if (password === null) {
    process.exitCode = 1;
    return;
  }

  const result = await recoverAdmin(username, await hashPassword(password));
  if (!result) {
    console.error('Tài khoản admin không còn khớp với username đã nhập.');
    process.exitCode = 1;
    return;
  }

  console.log('Đã đặt lại mật khẩu admin. Admin phải đổi mật khẩu khi đăng nhập.');

  if (result.email) {
    try {
      await mailer.sendMail({
        to: result.email,
        subject: 'Cảnh báo khôi phục tài khoản Chatio',
        text: 'Mật khẩu tài khoản admin Chatio đã được đặt lại bằng quy trình khẩn cấp.',
      });
    } catch {
      console.error('Mật khẩu đã được đặt lại. Không gửi được email cảnh báo.');
    }
  }
};

try {
  await main();
} catch (error) {
  console.error(
    error.name === 'AbortError'
      ? 'Đã hủy thao tác khôi phục admin.'
      : 'Không thể hoàn thành thao tác khôi phục admin.',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}