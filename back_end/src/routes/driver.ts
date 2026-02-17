import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import * as DriverController from '../controllers/DriverController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const userId = req.user?.id || 'anonymous';
            const dest = path.join('uploads', String(userId), 'proofs');
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'proof-' + uniqueSuffix + path.extname(file.originalname));
        }
    })
});
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
