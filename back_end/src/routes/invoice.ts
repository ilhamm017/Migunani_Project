import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import * as InvoiceController from '../controllers/InvoiceController';

const router = Router();

router.get('/:id', authenticateToken, InvoiceController.getInvoiceDetail);

export default router;
