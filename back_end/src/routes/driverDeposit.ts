import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import * as DriverDepositController from '../controllers/DriverDepositController';

const router = Router();

router.use(authenticateToken);
router.get('/', authorizeRoles('kasir', 'super_admin'), DriverDepositController.getDriverDepositList);
router.get('/history', authorizeRoles('kasir', 'super_admin'), DriverDepositController.getDriverDepositHistory);
router.post('/confirm', authorizeRoles('kasir', 'super_admin'), DriverDepositController.confirmDriverDeposit);

export default router;
