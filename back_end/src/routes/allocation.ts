import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as OrderAllocationController from '../controllers/OrderAllocationController';

const router = Router();

router.use(authenticate);
router.use(requireRole('super_admin', 'kasir', 'admin_finance'));

router.get('/pending', OrderAllocationController.getPendingAllocations);
router.get('/product/:productId', OrderAllocationController.getProductAllocations);
router.post('/:id/cancel-backorder', OrderAllocationController.cancelBackorder);
router.get('/:id', OrderAllocationController.getOrderDetails);
router.post('/:id', OrderAllocationController.allocateOrder);

export default router;
