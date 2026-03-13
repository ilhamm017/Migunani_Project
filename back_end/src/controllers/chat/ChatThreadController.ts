import { Request, Response } from 'express';
import {
    ContactQueryType,
    OpenThreadMode,
    ThreadScope,
    listContacts,
    listThreads,
    markThreadAsRead,
    openThread
} from '../../services/ChatThreadService';
import {
    asActor,
    emitThreadRead,
    emitUnreadBadgeForThread,
    mapChatServiceError
} from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getThreads = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const scope = String(req.query.scope || '').trim() as ThreadScope;
        const q = String(req.query.q || '').trim();
        const cursor = String(req.query.cursor || '').trim();
        const requestedLimit = Number(req.query.limit || 20);
        const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 20;

        const result = await listThreads({
            actor: asActor(req),
            scope: scope || undefined,
            q,
            cursor: cursor || undefined,
            limit
        });

        return res.json(result);
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        throw new CustomError(error?.message || 'Error fetching threads', 500);
    }
});

export const openChatThread = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const mode = String(req.body?.mode || '').trim() as OpenThreadMode;
        const targetUserId = String(req.body?.target_user_id || '').trim();
        if (!mode || !['staff_dm', 'staff_customer', 'support'].includes(mode)) {
            throw new CustomError('Mode thread tidak valid.', 400);
        }

        const thread = await openThread({
            actor: asActor(req),
            mode,
            targetUserId: targetUserId || undefined
        });

        return res.status(201).json({
            thread: {
                id: thread.id,
                thread_key: thread.thread_key,
                thread_type: thread.thread_type,
                customer_user_id: thread.customer_user_id,
                external_whatsapp_number: thread.external_whatsapp_number,
                last_message_at: thread.last_message_at
            }
        });
    } catch (error: any) {
        const code = String(error?.message || '');
        if (code === 'TARGET_NOT_FOUND') throw new CustomError('Target user tidak ditemukan.', 404);
        if (code === 'TARGET_REQUIRED') throw new CustomError('target_user_id wajib diisi.', 400);
        if (mapChatServiceError(res, error)) return;
        if (code.includes('FORBIDDEN') || code.startsWith('INVALID_') || code === 'SUPPORT_FORBIDDEN') {
            throw new CustomError('Anda tidak memiliki akses membuka thread ini.', 403);
        }
        throw new CustomError(error?.message || 'Error opening thread', 500);
    }
});

export const markThreadRead = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const threadId = String(req.params.threadId || '').trim();
        const result = await markThreadAsRead({
            actor: asActor(req),
            threadId
        });
        if (result.updated_count > 0) {
            emitThreadRead(result.thread.id, result.updated_count);
            await emitUnreadBadgeForThread({ threadId: result.thread.id });
        }
        return res.json({
            message: 'Thread marked as read',
            thread_id: result.thread.id,
            updated_count: result.updated_count
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        throw new CustomError(error?.message || 'Error marking thread as read', 500);
    }
});

export const getThreadContacts = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const type = String(req.query.type || 'staff').trim() as ContactQueryType;
        const q = String(req.query.q || '').trim();
        const requestedLimit = Number(req.query.limit || 20);
        const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 20;
        if (!['staff', 'customer_contextual'].includes(type)) {
            throw new CustomError('Tipe kontak tidak valid.', 400);
        }

        const contacts = await listContacts({
            actor: asActor(req),
            type,
            q,
            limit
        });
        return res.json({ contacts });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        throw new CustomError(error?.message || 'Error fetching contacts', 500);
    }
});
