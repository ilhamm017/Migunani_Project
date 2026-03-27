import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import {
    adminCreateClearancePromo,
    adminListClearancePromos,
    adminUpdateClearancePromo,
    getActiveClearancePromos
} from '../controllers/ClearancePromoController';

const router = Router();

// Public
router.get('/clearance-promos/active', getActiveClearancePromos);

// Admin
router.get('/admin/clearance-promos', authenticateToken, authorizeRoles('super_admin', 'kasir'), adminListClearancePromos);
router.post('/admin/clearance-promos', authenticateToken, authorizeRoles('super_admin'), adminCreateClearancePromo);
router.patch('/admin/clearance-promos/:id', authenticateToken, authorizeRoles('super_admin'), adminUpdateClearancePromo);

export default router;

