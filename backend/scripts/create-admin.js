import readline from 'node:readline';
import { pool, withTransaction } from '../src/db/pool.js';
import { hashPassword, validateNewPassword } from '../src/lib/passwords.js';
import { USERNAME_PATTERN } from '../src/models/user.js';
import { writeAudit } from '../src/lib/audit.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
});

rl._writeToOutput = () => {};

const queued = [];
const waiting = [];

rl.on('line', (line) =>
  waiting.length ? waiting.shift()(line) : queued.push(line)
);

rl.on('close', () =>
  waiting.splice(0).forEach((resolve) => resolve(''))
);

const askHidden = async (question) => {
  process.stdout.write(question);

  const answer = queued.length
    ? queued.shift()
    : await new Promise((resolve) => waiting.push(resolve));

  process.stdout.write('\n');

  return answer;
};

const main = async () => {
  try {
    const existingAdmin = await pool.query(
      `SELECT id FROM users WHERE global_role = 'admin' LIMIT 1`
    );

    if (existingAdmin.rowCount > 0) {
      console.error('Hệ thống đã có admin. Không được tạo thêm admin.');
      process.exitCode = 1;
      return;
    }

    const username = process.argv[2]
      || await askHidden('Username: ');

    if (!USERNAME_PATTERN.test(username)) {
      console.error('Username không hợp lệ.');
      process.exitCode = 1;
      return;
    }

    const email = (
      await askHidden('Email: ')
    ).trim().toLowerCase();

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      console.error('Email không hợp lệ.');
      process.exitCode = 1;
      return;
    }

    const password = await askHidden(
      'Mật khẩu khởi tạo (tối thiểu 15 ký tự): '
    );

    const passwordError = validateNewPassword(password);

    if (passwordError) {
      console.error(passwordError);
      process.exitCode = 1;
      return;
    }

    const confirmation = await askHidden('Nhập lại mật khẩu: ');

    if (confirmation !== password) {
      console.error('Hai lần nhập mật khẩu không khớp.');
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (
          username,
          email,
          password_hash,
          global_role,
          must_change_password
        )
        VALUES ($1, $2, $3, 'admin', TRUE)
        RETURNING id`,
        [username, email, passwordHash]
      );

      await writeAudit(
        {
          actorUserId: rows[0].id,
          eventType: 'ADMIN_CREATE',
          outcome: 'success',
        },
        client
      );
    });

    console.log('Đã tạo admin đầu tiên thành công.');
    console.log('Admin phải đổi mật khẩu và xác minh email.');
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint === 'users_single_admin_idx') {
        console.error('Hệ thống đã có admin.');
      } else {
        console.error('Username hoặc email đã tồn tại.');
      }
    } else {
      console.error('Không thể tạo tài khoản admin.');
    }

    process.exitCode = 1;
  }
};

main().finally(async () => {
  rl.close();
  await pool.end();
});