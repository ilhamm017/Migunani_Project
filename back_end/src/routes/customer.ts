import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as CustomerController from '../controllers/CustomerController';

const router = Router();

router.get('/', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomers);
router.get('/search', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.searchCustomers);
router.post('/otp/send', authenticate, requireRole('super_admin', 'kasir'), CustomerController.sendCustomerOtp);
router.post('/create', authenticate, requireRole('super_admin', 'kasir'), CustomerController.createCustomerByAdmin);
router.get('/:id', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomerById);
router.get('/:id/orders', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomerOrders);
router.patch('/:id/tier', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerTier);
router.patch('/:id/status', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerStatus);

export default router;
