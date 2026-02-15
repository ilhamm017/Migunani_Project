import { Router } from 'express';
import * as DriverController from '../controllers/DriverController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import multer from 'multer';

const upload = multer({ dest: 'uploads/proofs/' }); // Temp config
const router = Router();

router.use(authenticateToken);

router.get('/orders', authorizeRoles('driver', 'admin_gudang', 'super_admin'), DriverController.getAssignedOrders);
router.post('/orders/:id/complete', authorizeRoles('driver'), upload.single('proof'), DriverController.completeDelivery);
router.post('/orders/:id/issue', authorizeRoles('driver'), DriverController.reportIssue);
router.get('/wallet', authorizeRoles('driver', 'admin_finance', 'super_admin'), DriverController.getDriverWallet);
router.get('/retur', authorizeRoles('driver', 'admin_gudang', 'super_admin'), DriverController.getAssignedReturs);
router.get('/retur/:id', authorizeRoles('driver', 'admin_gudang', 'super_admin'), DriverController.getAssignedReturDetail);
router.patch('/retur/:id/status', authorizeRoles('driver'), DriverController.updateAssignedReturStatus);

export default router;
