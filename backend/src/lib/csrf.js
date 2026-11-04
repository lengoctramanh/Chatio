import crypto from 'node:crypto';
import { config } from '../config.js';

// CSRF token gắn với từng phiên: HMAC(CSRF_SECRET, sessionId).
// Không cần lưu thêm vào DB; phiên bị thu hồi thì token cũng mất tác dụng.
export const csrfTokenFor = (sessionId) =>
  crypto.createHmac('sha256', config.csrfSecret).update(`csrf:${sessionId}`).digest('base64url');

export const isValidCsrfToken = (sessionId, token) => {
  if (typeof token !== 'string') return false;
  const expected = Buffer.from(csrfTokenFor(sessionId));
  const received = Buffer.from(token);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
};
