import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import * as InvoiceController from '../controllers/InvoiceController';
import { createImageUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const proofUpload = createImageUpload('proofs', 'proof');
const uploadPaymentProofMiddleware = createSingleUploadMiddleware(proofUpload, {
    fieldName: 'proof',
    sizeExceededMessage: 'Ukuran bukti pembayaran terlalu besar (maksimal 5MB).',
    fallbackMessage: 'Upload bukti pembayaran gagal diproses.'
	});

	router.get('/my', authenticateToken, InvoiceController.getMyInvoices);
	router.get('/admin/warehouse/queue', authenticateToken, InvoiceController.getWarehouseInvoiceQueue);
	router.get('/admin/warehouse/picklist', authenticateToken, InvoiceController.getWarehouseProductPicklist);
	router.get('/admin/warehouse/picklist.xlsx', authenticateToken, InvoiceController.exportWarehouseProductPicklistExcel);
	router.get('/:id', authenticateToken, InvoiceController.getInvoiceDetail);
	router.get('/:id/picklist', authenticateToken, InvoiceController.getInvoicePicklist);
	router.get('/:id/picklist.xlsx', authenticateToken, InvoiceController.exportInvoicePicklistExcel);
	router.post('/:id/proof', authenticateToken, uploadPaymentProofMiddleware, InvoiceController.uploadInvoicePaymentProof);
	router.patch('/:id/assign-driver', authenticateToken, InvoiceController.assignInvoiceDriver);

	export default router;
