import { Router } from 'express';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as StockOpnameController from '../controllers/StockOpnameController';

const router = Router();

router.use(authenticate);
router.use(requireRole('super_admin', 'admin_gudang'));

router.get('/', StockOpnameController.getAllOpnames);
router.post('/', StockOpnameController.startOpname);
router.get('/:id', StockOpnameController.getOpnameDetail);
router.post('/:id/item', StockOpnameController.submitOpnameItem); // Audit item specific
router.post('/:id/finish', StockOpnameController.finishOpname);

export default router;
