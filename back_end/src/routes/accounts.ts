import { Router } from 'express';
import * as AccountController from '../controllers/AccountController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);
router.use(authorizeRoles('super_admin', 'admin_finance'));

router.get('/', AccountController.getAccounts);
router.post('/', AccountController.createAccount);
router.put('/:id', AccountController.updateAccount);
router.delete('/:id', AccountController.deleteAccount);

export default router;
