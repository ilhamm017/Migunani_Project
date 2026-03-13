import { Router } from 'express';
import * as OrderController from '../controllers/order';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { createImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const proofUpload = createImageUpload('proofs', 'proof');
const uploadPaymentProofMiddleware = createSingleUploadMiddleware(proofUpload, {
    fieldName: 'proof',
    sizeExceededMessage: 'Ukuran bukti pembayaran terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload bukti pembayaran gagal diproses.'
});

// Customer Routes
router.post('/checkout', authenticateToken, OrderController.checkout);
router.get('/my-orders', authenticateToken, OrderController.getMyOrders);
router.get('/:id', authenticateToken, OrderController.getOrderDetails);
router.post('/:id/proof', authenticateToken, uploadPaymentProofMiddleware, OrderController.uploadPaymentProof);

// Admin Routes
router.get('/admin/stats', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getDashboardStats);
router.get('/admin/list', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getAllOrders);
router.get('/admin/couriers', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.getDeliveryEmployees);
router.patch('/admin/:id/status', authenticateToken, authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir'), OrderController.updateOrderStatus);

export default router;
