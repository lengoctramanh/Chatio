import cookieParser from 'cookie-parser';
import express from 'express';
import { pool } from './db/pool.js';
import { sendError } from './lib/httpError.js';
import { rejectCrossSiteRequests } from './middleware/sameOrigin.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { emailRouter } from './routes/email.js';
import { passwordRecoveryRouter } from './routes/passwordRecovery.js';
import { conversationsRouter } from './routes/conversations.js';

export const app = express();

app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api/auth', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', rejectCrossSiteRequests);
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/db-health', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS user'
    );

    res.json({ status: 'ok', ...result.rows[0] });
  } catch {
    console.error('Database health check failed');
    res.status(500).json({ status: 'error' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/auth', emailRouter);
app.use('/api/auth', passwordRecoveryRouter);
app.use('/api/admin', adminRouter);
app.use('/api/conversations', conversationsRouter);

app.use('/api', (_req, res) =>
  sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy API')
);

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return sendError(
      res,
      400,
      'INVALID_JSON',
      'Dữ liệu JSON không hợp lệ'
    );
  }

  if (error.type === 'entity.too.large') {
    return sendError(
      res,
      413,
      'PAYLOAD_TOO_LARGE',
      'Dữ liệu gửi lên quá lớn'
    );
  }

  console.error('Internal request error');

  return sendError(
    res,
    500,
    'INTERNAL_ERROR',
    'Đã có lỗi xảy ra, vui lòng thử lại sau'
  );
});