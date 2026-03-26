import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import * as PosSalesController from '../controllers/pos/sales';
import * as PosReportsController from '../controllers/pos/reports';

const router = Router();

router.use(authenticateToken);

router.post('/sales', authorizeRoles('super_admin', 'kasir'), PosSalesController.createPosSale);
router.get('/sales', authorizeRoles('super_admin', 'kasir'), PosSalesController.listPosSales);
router.get('/sales/:id', authorizeRoles('super_admin', 'kasir'), PosSalesController.getPosSaleById);
router.post('/sales/:id/void', authorizeRoles('super_admin', 'kasir'), PosSalesController.voidPosSale);

router.get('/reports/daily-summary', authorizeRoles('super_admin', 'kasir'), PosReportsController.getDailySummary);

export default router;

