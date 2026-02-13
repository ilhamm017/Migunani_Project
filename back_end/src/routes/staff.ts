import { Router } from 'express';
import * as StaffController from '../controllers/StaffController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateToken);
router.use(authorizeRoles('super_admin'));

router.get('/', StaffController.getStaff);
router.get('/:id', StaffController.getStaffById);
router.post('/', StaffController.createStaff);
router.patch('/:id', StaffController.updateStaff);
router.delete('/:id', StaffController.deactivateStaff);

export default router;
