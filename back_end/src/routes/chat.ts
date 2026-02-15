import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import * as ChatController from '../controllers/ChatController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';

const router = Router();
const chatUploadsDir = path.resolve(process.cwd(), 'uploads', 'chat');
if (!fs.existsSync(chatUploadsDir)) {
    fs.mkdirSync(chatUploadsDir, { recursive: true });
}

const allowedAttachmentMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-rar-compressed'
]);

const chatUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, chatUploadsDir),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase();
            const safeExt = ext.replace(/[^a-z0-9.]/g, '');
            const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            cb(null, `chat-${stamp}${safeExt}`);
        }
    }),
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (_req, file, cb) => {
        if (allowedAttachmentMimeTypes.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('UNSUPPORTED_ATTACHMENT_TYPE'));
    }
});

const uploadAttachmentMiddleware = (req: Request, res: Response, next: NextFunction) => {
    chatUpload.single('attachment')(req, res, (err) => {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Ukuran lampiran terlalu besar (maksimal 10MB).' });
        }
        if (err instanceof Error && err.message === 'UNSUPPORTED_ATTACHMENT_TYPE') {
            return res.status(400).json({ message: 'Format lampiran tidak didukung.' });
        }
        if (err) {
            return res.status(400).json({ message: 'Upload lampiran gagal diproses.' });
        }
        return next();
    });
};

// Public endpoint for customer web widget attachment upload
router.post('/web/attachment', uploadAttachmentMiddleware, ChatController.uploadWebAttachment);
router.get('/web/messages', ChatController.getWebMessages);
router.get('/web/session/me', authenticateToken, ChatController.getMyWebSession);
router.get('/web/sessions/me', authenticateToken, ChatController.getMyWebSessions);
router.get('/web/session/by-staff', authenticateToken, ChatController.getMyWebSessionByStaff);

router.use(authenticateToken); // Admin only mostly

router.get('/threads', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'), ChatController.getThreads);
router.post('/threads/open', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'), ChatController.openChatThread);
router.get('/threads/:threadId/messages', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'), ChatController.getThreadMessagesV2);
router.post(
    '/threads/:threadId/messages',
    authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'),
    uploadAttachmentMiddleware,
    ChatController.sendThreadMessage
);
router.post('/threads/:threadId/read', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'), ChatController.markThreadRead);
router.get('/contacts', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'), ChatController.getThreadContacts);

// List Chats (Admin)
router.get('/sessions', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'), ChatController.getSessions);

// Get Messages
router.get('/sessions/:id/messages', authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'), ChatController.getMessages);

// Reply
router.post(
    '/sessions/:id/reply',
    authorizeRoles('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'),
    uploadAttachmentMiddleware,
    ChatController.replyToChat
);

export default router;
