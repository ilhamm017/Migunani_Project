import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import * as DeliveryHandoverController from '../controllers/DeliveryHandoverController';
import { createFieldsUploadMiddleware, createMultiFieldImageUpload } from '../utils/uploadPolicy';

const router = Router();

const upload = createMultiFieldImageUpload(
    'delivery_handovers',
    { evidence: 'evidence', item_evidences: 'item' },
    21
);
const uploadEvidenceMiddleware = createFieldsUploadMiddleware(upload, {
    fields: [
        { name: 'evidence', maxCount: 1 },
        { name: 'item_evidences', maxCount: 20 },
    ],
    sizeExceededMessage: 'Ukuran foto terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload foto gagal diproses.'
});

router.post(
    '/check',
    authenticateToken,
    authorizeRoles('super_admin', 'checker_gudang'),
    uploadEvidenceMiddleware,
    DeliveryHandoverController.checkInvoice
);

router.get(
    '/latest',
    authenticateToken,
    authorizeRoles('super_admin', 'checker_gudang'),
    DeliveryHandoverController.getLatestByInvoice
);

router.post(
    '/:id/handover',
    authenticateToken,
    authorizeRoles('super_admin', 'checker_gudang'),
    DeliveryHandoverController.handoverToDriver
);

export default router;
