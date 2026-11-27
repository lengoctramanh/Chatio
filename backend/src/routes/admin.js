import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { countRemainingRecoveryCodes } from '../services/adminRecovery.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    admin: req.user.username,
  });
});

adminRouter.get('/recovery-codes/status', async (req, res) => {
  const remaining = await countRemainingRecoveryCodes(req.user.id);

  res.set('Cache-Control', 'no-store');

  return res.json({
    remaining,
    needsSetup: remaining === 0,
    warning: remaining <= 2
      ? 'Số mã khôi phục còn ít hoặc chưa được thiết lập. Vui lòng tạo bộ mã mới.'
      : null,
  });
});