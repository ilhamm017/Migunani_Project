import { Router } from 'express';
import fs from 'fs';
import { authenticateToken as authenticate, authorizeRoles as requireRole } from '../middleware/authMiddleware';
import * as ReturController from '../controllers/ReturController';
import multer from 'multer';
import path from 'path';

const router = Router();

// Multer Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.user?.id || 'anonymous';
        const dest = path.join('uploads', String(userId), 'retur');
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'retur-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Customer Routes
router.post('/request', authenticate, upload.single('evidence_img'), ReturController.requestRetur);
router.get('/my', authenticate, ReturController.getMyReturs);

// Admin Routes
router.get('/all', authenticate, requireRole('super_admin', 'kasir', 'admin_finance'), ReturController.getAllReturs);
router.put('/:id/status', authenticate, requireRole('super_admin', 'kasir'), ReturController.updateReturStatus);
router.post('/:id/disburse', authenticate, requireRole('super_admin', 'admin_finance'), ReturController.disburseRefund);

export default router;
