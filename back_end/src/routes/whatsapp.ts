import { Router } from 'express';
import * as WhatsappController from '../controllers/WhatsappController';
import { authenticateTokenStateless, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateTokenStateless);

router.get('/qr', authorizeRoles('super_admin', 'kasir'), WhatsappController.getQrCode);
router.get('/status', authorizeRoles('super_admin', 'kasir'), WhatsappController.getClientStatus);
router.get('/groups', authorizeRoles('super_admin', 'kasir'), WhatsappController.listGroups);
router.post('/scrape/sessions', authorizeRoles('super_admin', 'kasir'), WhatsappController.scrapeCreateSession);
router.get('/scrape/sessions/:sessionId', authorizeRoles('super_admin', 'kasir'), WhatsappController.scrapeGetSession);
router.get('/scrape/sessions/:sessionId/messages', authorizeRoles('super_admin', 'kasir'), WhatsappController.scrapeGetMessages);
router.get('/scrape/sessions/:sessionId/customers/:customerKey', authorizeRoles('super_admin', 'kasir'), WhatsappController.scrapeGetCustomer);
router.get('/scrape/sessions/:sessionId/media/:messageId', authorizeRoles('super_admin', 'kasir'), WhatsappController.scrapeGetMedia);
router.post('/connect', authorizeRoles('super_admin', 'kasir'), WhatsappController.connect);
router.post('/logout', authorizeRoles('super_admin', 'kasir'), WhatsappController.logout);

export default router;
