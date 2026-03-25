import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as ReturController from '../controllers/ReturController';
import * as ReturHandoverController from '../controllers/ReturHandoverController';
import { createImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const returUpload = createImageUpload('retur', 'retur');
const requestReturUploadMiddleware = createSingleUploadMiddleware(returUpload, {
    fieldName: 'evidence_img',
    sizeExceededMessage: 'Ukuran bukti retur terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload bukti retur gagal diproses.'
});

// Customer Routes
router.post('/request', authenticate, requestReturUploadMiddleware, ReturController.requestRetur);
router.get('/my', authenticate, ReturController.getMyReturs);

// Admin Routes
router.get('/all', authenticate, requireRole('super_admin', 'kasir', 'admin_finance', 'admin_gudang'), ReturController.getAllReturs);
router.put('/:id/status', authenticate, requireRole('super_admin', 'kasir', 'admin_gudang'), ReturController.updateReturStatus);
router.post('/:id/disburse', authenticate, requireRole('super_admin', 'admin_finance'), ReturController.disburseRefund);

// Retur Handovers (Gudang/Kasir)
router.get('/handovers', authenticate, requireRole('super_admin', 'kasir', 'admin_gudang'), ReturHandoverController.getReturHandovers);
router.post('/handovers/:id/receive', authenticate, requireRole('super_admin', 'kasir', 'admin_gudang'), ReturHandoverController.receiveReturHandover);

export default router;
