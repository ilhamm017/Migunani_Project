import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import * as DeliveryHandoverController from '../controllers/DeliveryHandoverController';
import { createImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();

const evidenceUpload = createImageUpload('delivery_handovers', 'evidence');
const uploadEvidenceMiddleware = createSingleUploadMiddleware(evidenceUpload, {
    fieldName: 'evidence',
    sizeExceededMessage: 'Ukuran foto terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload foto gagal diproses.'
});

router.post(
    '/check',
    authenticateToken,
    authorizeRoles('super_admin', 'admin_gudang', 'checker_gudang'),
    uploadEvidenceMiddleware,
    DeliveryHandoverController.checkInvoice
);

router.get(
    '/latest',
    authenticateToken,
    authorizeRoles('super_admin', 'admin_gudang', 'checker_gudang'),
    DeliveryHandoverController.getLatestByInvoice
);

router.post(
    '/:id/handover',
    authenticateToken,
    authorizeRoles('super_admin', 'admin_gudang', 'checker_gudang'),
    DeliveryHandoverController.handoverToDriver
);

export default router;
