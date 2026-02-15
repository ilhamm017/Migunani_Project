import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as ShippingMethodController from '../controllers/ShippingMethodController';

const router = Router();

router.get('/', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), ShippingMethodController.getShippingMethods);
router.post('/', authenticate, requireRole('super_admin', 'kasir'), ShippingMethodController.createShippingMethod);
router.patch('/:code', authenticate, requireRole('super_admin', 'kasir'), ShippingMethodController.updateShippingMethod);
router.delete('/:code', authenticate, requireRole('super_admin', 'kasir'), ShippingMethodController.removeShippingMethod);

export default router;

