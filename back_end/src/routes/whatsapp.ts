import { Router } from 'express';
import * as WhatsappController from '../controllers/WhatsappController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);

router.get('/qr', authorizeRoles('super_admin', 'admin_gudang'), WhatsappController.getQrCode);
router.get('/status', authorizeRoles('super_admin', 'admin_gudang'), WhatsappController.getClientStatus);
router.post('/connect', authorizeRoles('super_admin', 'admin_gudang'), WhatsappController.connect);
router.post('/logout', authorizeRoles('super_admin'), WhatsappController.logout);

export default router;
