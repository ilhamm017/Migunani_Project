import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as CustomerController from '../controllers/customer';

const router = Router();

router.get('/', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomers);
router.get('/search', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.searchCustomers);
router.post('/otp/send', authenticate, requireRole('super_admin', 'kasir'), CustomerController.sendCustomerOtp);
router.post('/create', authenticate, requireRole('super_admin', 'kasir'), CustomerController.createCustomerByAdmin);
router.post('/quick-create', authenticate, requireRole('super_admin', 'kasir'), CustomerController.createCustomerQuickByAdmin);
router.get('/:id', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomerById);
router.get('/:id/top-products', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomerTopProducts);
router.get('/:id/orders', authenticate, requireRole('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), CustomerController.getCustomerOrders);
router.get('/:id/balance', authenticate, requireRole('super_admin', 'admin_finance', 'kasir'), CustomerController.getCustomerBalance);
router.post('/:id/balance/manual-payment', authenticate, requireRole('super_admin', 'admin_finance', 'kasir'), CustomerController.manualPayment);
router.post('/:id/balance/manual-refund', authenticate, requireRole('super_admin', 'admin_finance', 'kasir'), CustomerController.manualRefund);
router.post('/:id/balance/manual-adjustment', authenticate, requireRole('super_admin', 'admin_finance', 'kasir'), CustomerController.manualAdjustment);
router.patch('/:id/email', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerEmailByAdmin);
router.patch('/:id/password', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerPasswordByAdmin);
router.patch('/:id/tier', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerTier);
router.patch('/:id/status', authenticate, requireRole('super_admin', 'kasir'), CustomerController.updateCustomerStatus);

export default router;
