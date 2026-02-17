import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import * as OrderController from '../controllers/OrderController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();
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

// Customer Routes
router.post('/checkout', authenticateToken, OrderController.checkout);
router.get('/my-orders', authenticateToken, OrderController.getMyOrders);
router.get('/:id', authenticateToken, OrderController.getOrderDetails);
router.post('/:id/proof', authenticateToken, upload.single('proof'), OrderController.uploadPaymentProof);

// Admin Routes
router.get('/admin/stats', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getDashboardStats);
router.get('/admin/list', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getAllOrders);
router.get('/admin/couriers', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getDeliveryEmployees);
router.patch('/admin/:id/status', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.updateOrderStatus);

export default router;
