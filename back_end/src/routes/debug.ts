import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { getTierPricingDebug } from '../controllers/debug/tierPricing';

const router = Router();

router.get('/tier-pricing', authenticateToken, authorizeRoles('super_admin', 'kasir'), getTierPricingDebug);

export default router;

