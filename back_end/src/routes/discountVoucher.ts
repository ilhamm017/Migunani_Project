import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as DiscountVoucherController from '../controllers/DiscountVoucherController';

const router = Router();

router.get('/', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), DiscountVoucherController.getDiscountVouchers);
router.post('/', authenticate, requireRole('super_admin', 'kasir'), DiscountVoucherController.createDiscountVoucher);
router.patch('/:code', authenticate, requireRole('super_admin', 'kasir'), DiscountVoucherController.updateDiscountVoucher);
router.delete('/:code', authenticate, requireRole('super_admin', 'kasir'), DiscountVoucherController.removeDiscountVoucher);

export default router;
