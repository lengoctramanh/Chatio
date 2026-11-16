// Tạo tài khoản quản trị viên đầu tiên (hệ thống không có đăng ký công khai).
// Cách dùng:  npm run create-admin -- <username>
// Mật khẩu được nhập ẩn từ bàn phím, không truyền qua tham số dòng lệnh để không lộ trong lịch sử shell.

import readline from 'node:readline';
import { pool } from '../src/db/pool.js';
import { hashPassword, validateNewPassword } from '../src/lib/passwords.js';
import { USERNAME_PATTERN, createUser } from '../src/models/user.js';

// Một interface dùng chung; không echo ký tự gõ vào. Dòng nhập được xếp hàng
// để vẫn chạy đúng khi stdin là pipe (đọc nhiều dòng cùng lúc).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = () => {};
const queued = [];
const waiting = [];
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
rl.on('close', () => waiting.splice(0).forEach((resolve) => resolve('')));

const askHidden = async (question) => {
  process.stdout.write(question);
  const answer = queued.length ? queued.shift() : await new Promise((r) => waiting.push(r));
  process.stdout.write('\n');
  return answer;
};

const main = async () => {
  const username = process.argv[2];
  if (!username || !USERNAME_PATTERN.test(username)) {
    console.error('Cách dùng: npm run create-admin -- <username>  (3–50 ký tự: chữ, số, . _ -)');
    process.exitCode = 1;
    return;
  }

  const password = await askHidden('Mật khẩu khởi tạo (tối thiểu 15 ký tự): ');
  const error = validateNewPassword(password);
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  if ((await askHidden('Nhập lại mật khẩu: ')) !== password) {
    console.error('Hai lần nhập không khớp');
    process.exitCode = 1;
    return;
  }

  try {
    const user = await createUser({ username, passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`Đã tạo admin "${user.username}". Lần đăng nhập đầu sẽ phải đổi mật khẩu.`);
  } catch (err) {
    console.error(err.code === '23505' ? 'Username đã tồn tại' : `Lỗi: ${err.message}`);
    process.exitCode = 1;
  }
};

main().finally(() => {
  rl.close();
  return pool.end();
});
