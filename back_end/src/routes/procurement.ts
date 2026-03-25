import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import {
    createSupplierPreorder,
    exportSupplierPreorderXlsx,
    finalizeSupplierPreorder,
    getSupplierPreorderById,
    listSupplierPreorders,
    updateSupplierPreorder
} from '../controllers/procurement/preorders';

const router = Router();

// PO (PreOrder Supplier) - planning module
router.post('/admin/procurement/preorders', authenticateToken, authorizeRoles('super_admin', 'kasir'), createSupplierPreorder);
router.get('/admin/procurement/preorders', authenticateToken, authorizeRoles('super_admin', 'kasir'), listSupplierPreorders);
router.get('/admin/procurement/preorders/:id', authenticateToken, authorizeRoles('super_admin', 'kasir'), getSupplierPreorderById);
router.patch('/admin/procurement/preorders/:id', authenticateToken, authorizeRoles('super_admin', 'kasir'), updateSupplierPreorder);
router.post('/admin/procurement/preorders/:id/finalize', authenticateToken, authorizeRoles('super_admin', 'kasir'), finalizeSupplierPreorder);
router.get('/admin/procurement/preorders/:id/export-xlsx', authenticateToken, authorizeRoles('super_admin', 'kasir'), exportSupplierPreorderXlsx);

export default router;

