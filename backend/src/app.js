import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from './db/pool.js';
import { sendError } from './lib/httpError.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/db-health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT current_database() AS database, current_user AS user');
    res.json({ status: 'ok', ...result.rows[0] });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: 'error' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy API'));

// Express 5 tự chuyển lỗi của handler async vào đây.
// Không trả chi tiết lỗi về client và không log request body (có thể chứa mật khẩu).
app.use((error, req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Dữ liệu JSON không hợp lệ');
  }
  if (error.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn');
  }
  console.error(`[${req.method} ${req.path}]`, error.message);
  return sendError(res, 500, 'INTERNAL_ERROR', 'Đã có lỗi xảy ra, vui lòng thử lại sau');
});
