import dotenv from 'dotenv';

// Chạy ngoài Docker: đọc file .env ở thư mục gốc Chatio.
// Trong Docker, biến môi trường đến từ compose.yaml; dotenv không ghi đè biến đã có.
dotenv.config({ path: new URL('../../.env', import.meta.url), quiet: true });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isProduction = process.env.NODE_ENV === 'production';

const csrfSecret = process.env.CSRF_SECRET ?? '';
if (csrfSecret.length < 32) {
  throw new Error('CSRF_SECRET phải được đặt trong .env và dài ít nhất 32 ký tự');
}

export const config = Object.freeze({
  isProduction,
  port: toInt(process.env.PORT, 3000),

  session: {
    cookieName: 'chatio_sid',
    // SEC-02: hết hạn sau 15 phút không hoạt động.
    idleMinutes: toInt(process.env.SESSION_IDLE_MINUTES, 15),
    // Thời hạn tuyệt đối của một phiên, dù vẫn hoạt động.
    absoluteHours: toInt(process.env.SESSION_ABSOLUTE_HOURS, 8),
    // Chỉ đặt COOKIE_SECURE=false khi chạy thử qua HTTP trên LAN.
    cookieSecure: process.env.COOKIE_SECURE !== 'false',
  },

  csrfSecret,

  password: {
    // SEC-01: tối thiểu 15 ký tự.
    minLength: 15,
    maxLength: 256,
  },

  loginLimit: {
    windowMinutes: toInt(process.env.LOGIN_LIMIT_WINDOW_MINUTES, 15),
    maxFailuresPerAccount: toInt(process.env.LOGIN_LIMIT_PER_ACCOUNT, 5),
    maxFailuresPerIp: toInt(process.env.LOGIN_LIMIT_PER_IP, 20),
  },
});
