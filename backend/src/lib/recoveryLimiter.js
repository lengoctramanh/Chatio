import { createHash } from 'node:crypto';

const buckets = new Map();
const WINDOW_MS = 15 * 60 * 1000;

const limits = Object.freeze({
  emailVerification: { account: 3, ip: 20 },
  forgotPassword: { account: 3, ip: 20 },
  forgotPasswordAccount: { account: 3 },
  resetPassword: { account: 5, ip: 20 },
  recoveryCodeAttempt: { account: 5, ip: 15 },
  recoveryCodes: { account: 3, ip: 10 },
  emailChange: { account: 3, ip: 10 },
});

const digest = (value) =>
  createHash('sha256')
    .update(String(value))
    .digest('hex');

export const consumeRecoveryLimit = (action, account, ip) => {
  const policy = limits[action];

  if (!policy) {
    throw new Error('Rate limit action không hợp lệ');
  }

  const now = Date.now();

  const keys = [
  {
    key: `${action}:account:${digest(
      String(account ?? '').trim().toLowerCase()
    )}`,
    max: policy.account,
  },
];

if (policy.ip !== undefined) {
  keys.push({
    key: `${action}:ip:${digest(ip ?? 'unknown')}`,
    max: policy.ip,
  });
}

  let retryAfter = 0;

  for (const { key, max } of keys) {
    const bucket = buckets.get(key);

    if (
      bucket &&
      bucket.resetAt > now &&
      bucket.count >= max
    ) {
      retryAfter = Math.max(
        retryAfter,
        Math.ceil((bucket.resetAt - now) / 1000)
      );
    }
  }

  if (retryAfter > 0) return retryAfter;

  for (const { key } of keys) {
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + WINDOW_MS,
      };
    }

    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return 0;
};

export const resetRecoveryLimiter = () => buckets.clear();

setInterval(() => {
  const now = Date.now();

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}, 60 * 1000).unref();