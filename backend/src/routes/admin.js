import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const adminRouter = Router();

// Mọi route trong /api/admin đều yêu cầu đăng nhập và vai trò admin.
adminRouter.use(requireAuth, requireRole('admin'));

/** GET /api/admin/ping — API thử nghiệm để kiểm tra middleware phân quyền. */
adminRouter.get('/ping', (req, res) => {
  res.json({ status: 'ok', admin: req.user.username });
});
