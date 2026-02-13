import { Router } from 'express';
import * as PosController from '../controllers/PosController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

// Shift Management
router.post('/shift/start', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.startShift);
router.post('/shift/end', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.endShift);

// Transaction Management
router.get('/customers/search', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.searchCustomers);
router.post('/checkout', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.checkoutOrder);
router.post('/hold', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.holdOrder);
router.get('/hold', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.getHoldOrders);
router.get('/resume/:id', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.resumeOrder);
router.delete('/void/:id', authorizeRoles('kasir', 'admin_gudang', 'super_admin'), PosController.voidTransaction);

export default router;
