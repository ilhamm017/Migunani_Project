import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import {
    adminCreateClearancePromo,
    adminDeleteClearancePromo,
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
router.delete('/admin/clearance-promos/:id', authenticateToken, authorizeRoles('super_admin'), adminDeleteClearancePromo);

export default router;
