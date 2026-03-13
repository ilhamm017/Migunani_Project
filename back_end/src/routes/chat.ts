import { Router } from 'express';
import * as ChatController from '../controllers/ChatController';
import { authenticateToken, authorizeRoles } from '../middleware/authMiddleware';
import { createAttachmentUpload, createSingleUploadMiddleware } from '../utils/uploadPolicy';

const router = Router();
const chatUpload = createAttachmentUpload({
    folderName: 'chat',
    prefix: 'chat',
    allowedMimeTypes: [
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
    ],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar'],
    fallbackExtension: '.bin',
    maxSizeBytes: 10 * 1024 * 1024,
    resolveOwnerSegment: (req) => String(req.user?.id || req.body.guest_id || 'anonymous'),
    unsupportedTypeMessage: 'Format lampiran tidak didukung.'
});

const uploadAttachmentMiddleware = createSingleUploadMiddleware(chatUpload, {
    fieldName: 'attachment',
    sizeExceededMessage: 'Ukuran lampiran terlalu besar (maksimal 10MB).',
    fallbackMessage: 'Upload lampiran gagal diproses.'
});

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
