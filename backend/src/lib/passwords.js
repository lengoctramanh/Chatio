import argon2 from 'argon2';
import { config } from '../config.js';

// SEC-01: Argon2id, salt ngẫu nhiên do thư viện tự sinh và lưu trong chuỗi hash.
const HASH_OPTIONS = { type: argon2.argon2id };

export const hashPassword = (password) => argon2.hash(password, HASH_OPTIONS);

export const verifyPassword = async (hash, password) => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
};

// Hash giả dùng khi không tìm thấy tài khoản, để thời gian phản hồi
// không tiết lộ username có tồn tại hay không (ACC-03).
let dummyHashPromise;
export const verifyAgainstDummy = async (password) => {
  dummyHashPromise ??= hashPassword('chatio-dummy-password-never-matches');
  await verifyPassword(await dummyHashPromise, password);
  return false;
};

/** @returns {string | null} thông báo lỗi, hoặc null nếu hợp lệ */
export const validateNewPassword = (password) => {
  const { minLength, maxLength } = config.password;
  if (typeof password !== 'string') return 'Mật khẩu không hợp lệ';
  if (password.length < minLength) return `Mật khẩu phải có ít nhất ${minLength} ký tự`;
  if (password.length > maxLength) return `Mật khẩu không được dài quá ${maxLength} ký tự`;
  return null;
};
