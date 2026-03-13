import { Request, Response } from 'express';
import path from 'path';
import { ChatSession, ChatThread, User } from '../../models';
import {
    ChatActor,
    ChatMessageChannel,
    resolveThreadForLegacySession,
} from '../../services/ChatThreadService';
import {
    buildUnreadBadgePayloadsForThread
} from '../../services/ChatBadgeService';
import { io } from '../../server';
import { normalizeWhatsappNumber } from '../../utils/whatsappNumber';
import { sendWhatsappSafe } from '../../services/WhatsappSendService';

export const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';
export const INTERNAL_STAFF_ROLES = ['super_admin', 'kasir', 'admin_gudang', 'admin_finance', 'driver'] as const;
export const SUPPORT_ROLES = new Set(['super_admin', 'kasir']);
export const isSupportRole = (role: string) => SUPPORT_ROLES.has(role);

export const asActor = (req: Request): ChatActor => ({
    id: String(req.user?.id || ''),
    role: String(req.user?.role || ''),
    whatsapp_number: req.user?.whatsapp_number,
});

import { CustomError } from '../../utils/CustomError';

export const mapChatServiceError = (res: Response, error: unknown): boolean => {
    const code = String((error as any)?.message || '');
    if (code === 'ACTOR_NOT_FOUND') {
        throw new CustomError('Sesi tidak valid. Silakan login ulang.', 401);
    }
    if (code === 'THREAD_NOT_FOUND') {
        throw new CustomError('Thread tidak ditemukan.', 404);
    }
    if (code === 'THREAD_FORBIDDEN') {
        throw new CustomError('Akses thread ditolak.', 403);
    }
    return false;
};

export const emitThreadMessage = (payload: {
    thread_id: string;
    channel: ChatMessageChannel;
    body: string;
    attachment_url?: string;
    sender: 'customer' | 'admin' | 'bot';
    sender_id?: string;
    timestamp: Date;
}) => {
    io.emit('chat:thread_message', {
        thread_id: payload.thread_id,
        channel: payload.channel,
        body: payload.body,
        attachment_url: payload.attachment_url,
        sender: payload.sender,
        sender_id: payload.sender_id,
        timestamp: payload.timestamp
    });

    // Legacy compatibility event
    io.emit('chat:message', {
        session_id: payload.thread_id,
        thread_id: payload.thread_id,
        platform: payload.channel === 'whatsapp' ? 'whatsapp' : 'web',
        body: payload.body,
        attachment_url: payload.attachment_url,
        sender: payload.sender,
        sender_id: payload.sender_id,
        timestamp: payload.timestamp
    });
};

export const emitThreadRead = (threadId: string, updatedCount: number) => {
    io.emit('chat:thread_read', {
        thread_id: threadId,
        updated_count: updatedCount
    });
    io.emit('chat:status', {
        session_id: threadId,
        action: 'marked_read',
        updated_count: updatedCount
    });
};

export const emitUnreadBadgeForThread = async (params: { threadId: string; excludeUserId?: string }) => {
    const payloads = await buildUnreadBadgePayloadsForThread(params);
    for (const payload of payloads) {
        io.emit('chat:unread_badge_updated', payload);
    }
};

export const resolveThreadByIdOrLegacySession = async (value: string): Promise<{ thread: ChatThread; session?: ChatSession | null }> => {
    const raw = String(value || '').trim();
    const byThread = await ChatThread.findByPk(raw);
    if (byThread) return { thread: byThread, session: null };

    const session = await ChatSession.findByPk(raw);
    if (!session) {
        throw new Error('THREAD_NOT_FOUND');
    }
    const thread = await resolveThreadForLegacySession(session);
    return { thread, session };
};

export const resolveWhatsappTargetForThread = async (thread: ChatThread): Promise<string | null> => {
    if (thread.thread_type === 'wa_lead') {
        const raw = String(thread.external_whatsapp_number || '');
        if (!raw || raw.startsWith('webguest:')) return null;
        return normalizeWhatsappNumber(raw);
    }
    if (thread.thread_type === 'support_omni' || thread.thread_type === 'staff_customer') {
        const customerId = String(thread.customer_user_id || '').trim();
        if (!customerId) return null;
        const user = await User.findByPk(customerId, { attributes: ['whatsapp_number'] });
        return normalizeWhatsappNumber(user?.whatsapp_number || '');
    }
    return null;
};

export const sendViaWhatsApp = async (targetNumber: string, payload: { body?: string; attachmentUrl?: string }) => {
    const textBody = String(payload.body || '').trim();
    const attachmentUrl = String(payload.attachmentUrl || '').trim();

    if (!textBody && !attachmentUrl) {
        throw new CustomError('Pesan atau lampiran wajib diisi.', 400);
    }
    const absoluteAttachmentPath = attachmentUrl
        ? path.resolve(process.cwd(), attachmentUrl.replace(/^\/+/, ''))
        : '';
    const result = await sendWhatsappSafe({
        target: targetNumber,
        textBody,
        attachmentPath: absoluteAttachmentPath || undefined,
        requestContext: 'chat_send'
    });

    if (result.status === 'skipped_not_ready') {
        throw new CustomError('WhatsApp belum terhubung. Silakan Connect WhatsApp terlebih dahulu.', 409);
    }
    if (result.status === 'skipped_no_target') {
        throw new CustomError('Target WhatsApp thread tidak valid.', 400);
    }
    if (result.status !== 'sent') {
        if (result.reason === 'attachment_missing') {
            throw new CustomError('File lampiran tidak ditemukan di server.', 400);
        }
        throw new CustomError('Gagal mengirim pesan WhatsApp.', 500);
    }
};

export const toLegacySessionRow = (row: any) => {
    const latest = row.latest_message || null;
    return {
        id: row.id,
        thread_type: row.thread_type,
        user_id: row.customer_user_id || null,
        platform: latest?.channel === 'whatsapp' ? 'whatsapp' : 'web',
        whatsapp_number: row.subtitle || row.external_whatsapp_number || '-',
        User: row.title
            ? {
                name: row.title,
                id: row.customer_user_id || undefined
            }
            : null,
        Messages: latest ? [{
            body: latest.body,
            attachment_url: latest.attachment_url,
            sender_type: latest.sender_type,
            is_read: latest.is_read,
            created_via: latest.created_via,
            sender_id: latest.sender_id,
            createdAt: latest.createdAt
        }] : [],
        unread_count: 0
    };
};
