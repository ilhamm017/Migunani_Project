import { Request, Response } from 'express';
import path from 'path';
import {
    ChatMessageChannel,
    canAccessThread,
    createThreadMessage,
    getThreadMessages
} from '../../services/ChatThreadService';
import { getStatus as getWhatsappStatus } from '../../services/whatsappClient';
import {
    ATTACHMENT_FALLBACK_BODY,
    asActor,
    emitThreadMessage,
    emitUnreadBadgeForThread,
    isSupportRole,
    mapChatServiceError,
    resolveThreadByIdOrLegacySession,
    resolveWhatsappTargetForThread,
    sendViaWhatsApp
} from './utils';

export const getThreadMessagesV2 = async (req: Request, res: Response) => {
    try {
        const threadId = String(req.params.threadId || '').trim();
        const cursor = String(req.query.cursor || '').trim();
        const requestedLimit = Number(req.query.limit || 50);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;

        const result = await getThreadMessages({
            actor: asActor(req),
            threadId,
            cursor: cursor || undefined,
            limit
        });

        return res.json({
            thread: {
                id: result.thread.id,
                thread_key: result.thread.thread_key,
                thread_type: result.thread.thread_type,
                customer_user_id: result.thread.customer_user_id,
                external_whatsapp_number: result.thread.external_whatsapp_number,
                last_message_at: result.thread.last_message_at
            },
            messages: result.messages,
            next_cursor: result.next_cursor
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error fetching thread messages' });
    }
};

export const sendThreadMessage = async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        const threadId = String(req.params.threadId || '').trim();
        const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const requestedChannel = String(req.body?.channel || '').trim() as ChatMessageChannel;
        const quotedMessageId = String(req.body?.quoted_message_id || '').trim();
        const attachmentUrl = req.file
            ? `/uploads/chat/${path.basename(req.file.path)}`
            : '';
        const body = rawMessage || (attachmentUrl ? ATTACHMENT_FALLBACK_BODY : '');

        if (!body && !attachmentUrl) {
            return res.status(400).json({ message: 'Pesan atau lampiran wajib diisi.' });
        }

        const { thread } = await resolveThreadByIdOrLegacySession(threadId);
        const canAccess = await canAccessThread(thread, actor);
        if (!canAccess) {
            return res.status(403).json({ message: 'Anda tidak memiliki akses ke thread ini.' });
        }

        let channel: ChatMessageChannel = requestedChannel === 'whatsapp' ? 'whatsapp' : 'app';
        if (!isSupportRole(actor.role)) {
            channel = 'app';
        }
        if (channel === 'whatsapp' && !(thread.thread_type === 'support_omni' || thread.thread_type === 'wa_lead')) {
            return res.status(400).json({ message: 'Channel WhatsApp hanya untuk thread support omnichannel/lead.' });
        }

        if (channel === 'whatsapp') {
            const targetNumber = await resolveWhatsappTargetForThread(thread);
            if (!targetNumber) {
                return res.status(400).json({ message: 'Target WhatsApp thread tidak valid.' });
            }
            if (getWhatsappStatus() !== 'READY') {
                return res.status(409).json({ message: 'WhatsApp belum terhubung. Silakan Connect WhatsApp terlebih dahulu.' });
            }
            await sendViaWhatsApp(targetNumber, {
                body: rawMessage,
                attachmentUrl: attachmentUrl || undefined
            });
        }

        const senderType = actor.role === 'customer' ? 'customer' : 'admin';
        const message = await createThreadMessage({
            threadId: thread.id,
            senderType,
            senderId: actor.id,
            body,
            attachmentUrl: attachmentUrl || undefined,
            channel,
            quotedMessageId: quotedMessageId || undefined,
            isRead: false,
            deliveryState: channel === 'whatsapp' ? 'delivered' : 'sent'
        });

        emitThreadMessage({
            thread_id: thread.id,
            channel,
            body: message.body,
            attachment_url: message.attachment_url || undefined,
            sender: senderType,
            sender_id: message.sender_id || undefined,
            timestamp: message.createdAt
        });
        await emitUnreadBadgeForThread({ threadId: thread.id, excludeUserId: actor.id });

        return res.status(201).json({
            message: 'Message sent',
            data: {
                id: message.id,
                thread_id: message.thread_id,
                body: message.body,
                attachment_url: message.attachment_url,
                sender_type: message.sender_type,
                sender_id: message.sender_id,
                channel: message.channel,
                created_via: message.created_via,
                delivery_state: message.delivery_state,
                is_read: message.is_read,
                read_at: message.read_at,
                createdAt: message.createdAt
            }
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error sending thread message' });
    }
};
