import { config } from '../config.js';

// SEC-01: giới hạn đăng nhập sai theo tài khoản và theo IP.
// Lưu trong bộ nhớ: đủ cho một tiến trình backend (quy mô 50 tài khoản).
// Nếu chạy nhiều instance thì cần chuyển sang Redis hoặc bảng trong CSDL.

const buckets = new Map(); // key -> { count, resetAt }

const windowMs = () => config.loginLimit.windowMinutes * 60 * 1000;

const read = (key, now) => {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.delete(key);
    return null;
  }
  return bucket;
};

const keysFor = (username, ip) => [
  { key: `acct:${String(username ?? '').toLowerCase()}`, max: config.loginLimit.maxFailuresPerAccount },
  { key: `ip:${ip ?? 'unknown'}`, max: config.loginLimit.maxFailuresPerIp },
];

/** @returns {number} số giây phải chờ; 0 nếu được phép thử */
export const retryAfterSeconds = (username, ip, now = Date.now()) => {
  let wait = 0;
  for (const { key, max } of keysFor(username, ip)) {
    const bucket = read(key, now);
    if (bucket && bucket.count >= max) {
      wait = Math.max(wait, Math.ceil((bucket.resetAt - now) / 1000));
    }
  }
  return wait;
};

export const recordFailure = (username, ip, now = Date.now()) => {
  for (const { key } of keysFor(username, ip)) {
    const bucket = read(key, now) ?? { count: 0, resetAt: now + windowMs() };
    bucket.count += 1;
    buckets.set(key, bucket);
  }
};

/** Đăng nhập thành công: xóa bộ đếm của tài khoản (giữ bộ đếm IP). */
export const recordSuccess = (username) => {
  buckets.delete(`acct:${String(username ?? '').toLowerCase()}`);
};

export const resetLoginLimiter = () => buckets.clear();

// Dọn bucket hết hạn định kỳ để Map không phình mãi.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 60 * 1000).unref();
