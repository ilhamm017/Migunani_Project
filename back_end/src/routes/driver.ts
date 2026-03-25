import { Router } from 'express';
import * as DriverController from '../controllers/driver';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { createImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const proofUpload = createImageUpload('proofs', 'proof');
const issueUpload = createImageUpload('issues', 'issue');
const paymentUpload = createImageUpload('payments', 'payment');
const completeDeliveryUploadMiddleware = createSingleUploadMiddleware(proofUpload, {
    fieldName: 'proof',
    sizeExceededMessage: 'Ukuran bukti pengiriman terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload bukti pengiriman gagal diproses.'
});
const recordPaymentUploadMiddleware = createSingleUploadMiddleware(paymentUpload, {
    fieldName: 'proof',
    sizeExceededMessage: 'Ukuran bukti pembayaran terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload bukti pembayaran COD gagal diproses.'
});
const issueEvidenceUploadMiddleware = createSingleUploadMiddleware(issueUpload, {
    fieldName: 'evidence',
    sizeExceededMessage: 'Ukuran lampiran issue terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload lampiran issue gagal diproses.'
});
const router = Router();

router.use(authenticateToken);

router.get('/orders', authorizeRoles('driver', 'admin_gudang', 'super_admin'), DriverController.getAssignedOrders);
router.post('/orders/:id/complete', authorizeRoles('driver'), completeDeliveryUploadMiddleware, DriverController.completeDelivery);
router.post('/orders/:id/retur', authorizeRoles('driver'), DriverController.createDeliveryReturTicket);
router.post('/orders/:id/payment', authorizeRoles('driver'), recordPaymentUploadMiddleware, DriverController.recordPayment);
router.patch('/orders/:id/payment-method', authorizeRoles('driver'), DriverController.updatePaymentMethod);
router.post('/orders/:id/issue', authorizeRoles('driver'), issueEvidenceUploadMiddleware, DriverController.reportIssue);
router.get('/wallet', authorizeRoles('driver', 'admin_finance', 'super_admin'), DriverController.getDriverWallet);
router.get('/retur', authorizeRoles('driver', 'super_admin'), DriverController.getAssignedReturs);
router.get('/retur/:id', authorizeRoles('driver', 'super_admin'), DriverController.getAssignedReturDetail);
router.patch('/retur/:id/status', authorizeRoles('driver'), DriverController.updateAssignedReturStatus);
router.post('/retur/handovers', authorizeRoles('driver'), DriverController.createReturHandover);

export default router;
