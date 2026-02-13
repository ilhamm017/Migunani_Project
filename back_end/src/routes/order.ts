import { Router } from 'express';
import multer from 'multer';
import * as OrderController from '../controllers/OrderController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();
const upload = multer({ dest: 'uploads/proofs/' }); // Temp storage

// Customer Routes
router.post('/checkout', authenticateToken, OrderController.checkout);
router.get('/my-orders', authenticateToken, OrderController.getMyOrders);
router.get('/:id', authenticateToken, OrderController.getOrderDetails);
router.post('/:id/proof', authenticateToken, upload.single('proof'), OrderController.uploadPaymentProof);

// Admin Routes
router.get('/admin/list', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance'), OrderController.getAllOrders);
router.get('/admin/couriers', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance'), OrderController.getDeliveryEmployees);
router.patch('/admin/:id/status', authenticateToken, authorizeRoles('super_admin', 'admin_gudang'), OrderController.updateOrderStatus);

export default router;
