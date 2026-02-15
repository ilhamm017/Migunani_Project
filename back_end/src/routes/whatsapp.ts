import { Router } from 'express';
import * as WhatsappController from '../controllers/WhatsappController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/qr', authorizeRoles('super_admin', 'kasir'), WhatsappController.getQrCode);
router.get('/status', authorizeRoles('super_admin', 'kasir'), WhatsappController.getClientStatus);
router.post('/connect', authorizeRoles('super_admin', 'kasir'), WhatsappController.connect);
router.post('/logout', authorizeRoles('super_admin', 'kasir'), WhatsappController.logout);

export default router;
