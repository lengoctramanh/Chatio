import { config } from '../config.js';
import { writeAudit } from '../lib/audit.js';
import { sendError } from '../lib/httpError.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/*
 * Chặn request thay đổi dữ liệu đến từ trang web khác (ACC-04, SEC-04).
 *
 * Lớp này bảo vệ cả những request chưa có phiên, đặc biệt là /api/auth/login
 * (login CSRF: trang độc hại tự gửi form đăng nhập để nạn nhân bị đăng nhập
 * vào tài khoản của kẻ tấn công). Với request đã có phiên, requireCsrf vẫn
 * kiểm tra thêm X-CSRF-Token.
 *
 * Dựa vào hai header do trình duyệt tự đặt, JavaScript trên trang không sửa được:
 *  - Sec-Fetch-Site: "cross-site" → từ chối.
 *  - Origin: phải là origin của chính backend hoặc nằm trong ALLOWED_ORIGINS;
 *    "null" (file://, iframe sandbox, redirect lạ) → từ chối.
 * Request không có cả hai header (curl, test, server gọi server) không phải
 * request trình duyệt nên không thể là CSRF và được cho qua.
 */
export const rejectCrossSiteRequests = async (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  const origin = req.get('origin');
  const ownOrigin = `${req.protocol}://${req.get('host')}`;

  let reason = null;
  if (fetchSite === 'cross-site') {
    reason = 'sec_fetch_site_cross_site';
  } else if (origin !== undefined) {
    const normalized = origin.replace(/\/+$/, '');
    if (normalized === 'null') reason = 'origin_null';
    else if (normalized !== ownOrigin && !config.allowedOrigins.includes(normalized)) {
      reason = 'origin_not_allowed';
    }
  }

  if (!reason) return next();

  await writeAudit({
    eventType: 'ACCESS_DENIED',
    outcome: 'failure',
    ip: req.ip,
    metadata: { reason, method: req.method, path: req.originalUrl, origin: origin ?? null },
  });
  return sendError(res, 403, 'CROSS_SITE_REQUEST', 'Yêu cầu từ nguồn không được phép');
};

/** Chỉ nhận body JSON. Form HTML của trang khác không gửi được application/json nếu không qua CORS. */
export const requireJsonBody = (req, res, next) => {
  if (!req.is('application/json')) {
    return sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Chỉ chấp nhận Content-Type: application/json');
  }
  return next();
};
