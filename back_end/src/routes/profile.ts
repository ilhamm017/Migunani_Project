import { Router } from 'express';
import { authenticateToken as authenticate } from '../middleware/authMiddleware';
import * as ProfileController from '../controllers/ProfileController';

const router = Router();

router.get('/me', authenticate, ProfileController.getMe);
router.patch('/addresses', authenticate, ProfileController.updateAddresses);

export default router;
