import { Request, Response } from 'express';
import { Op } from 'sequelize';
import path from 'path';
import { ChatThread, Message, User, sequelize } from '../../models';
import {
    ChatMessageChannel,
    ThreadScope,
    canAccessThread,
    createThreadMessage,
    getThreadMessages,
    listContacts,
    listThreads,
    markThreadAsRead,
    openThread
} from '../../services/ChatThreadService';
import {
    ATTACHMENT_FALLBACK_BODY,
    asActor,
    emitThreadMessage,
    emitThreadRead,
    emitUnreadBadgeForThread,
    isSupportRole,
    mapChatServiceError,
    resolveThreadByIdOrLegacySession,
    resolveWhatsappTargetForThread,
    sendViaWhatsApp,
    toLegacySessionRow
} from './utils';

import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getSessions = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        const platform = String(req.query.platform || '').trim();
        const status = String(req.query.status || '').trim();
        const userId = String(req.query.user_id || '').trim();
        const q = String(req.query.q || '').trim();
        const requestedLimit = Number(req.query.limit || 50);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;

        let scope: ThreadScope | undefined;
        if (platform === 'whatsapp') scope = 'wa_lead';
        if (platform === 'web') scope = undefined;

        const data = await listThreads({
            actor: asActor(req),
            scope,
            q,
            limit
        });

        let sessions = data.threads.map((row) => toLegacySessionRow(row));
        if (userId) {
            sessions = sessions.filter((row) => String(row.user_id || '') === userId);
            if (sessions.length === 0) {
                const actor = asActor(req);
                const target = await User.findByPk(userId, { attributes: ['id', 'role', 'name', 'whatsapp_number'] });
                if (target) {
                    let opened: ChatThread | null = null;
                    try {
                        if (actor.role === 'customer') {
                            if (target.role === 'driver') {
                                opened = await openThread({ actor, mode: 'staff_customer', targetUserId: target.id });
                            } else if (target.role === 'super_admin' || target.role === 'kasir') {
                                opened = await openThread({ actor, mode: 'support', targetUserId: target.id });
                            }
                        } else if (target.role === 'customer') {
                            opened = actor.role === 'super_admin' || actor.role === 'kasir'
                                ? await openThread({ actor, mode: 'support', targetUserId: target.id })
                                : await openThread({ actor, mode: 'staff_customer', targetUserId: target.id });
                        } else {
                            opened = await openThread({ actor, mode: 'staff_dm', targetUserId: target.id });
                        }
                    } catch (_error) {
                        opened = null;
                    }

                    if (opened) {
                        const latest = await Message.findOne({
                            where: { thread_id: opened.id },
                            order: [['id', 'DESC']],
                            attributes: ['body', 'attachment_url', 'sender_type', 'is_read', 'created_via', 'sender_id', 'channel', 'createdAt']
                        });

                        sessions = [{
                            id: opened.id,
                            thread_type: opened.thread_type,
                            user_id: opened.customer_user_id,
                            platform: latest?.channel === 'whatsapp' ? 'whatsapp' : 'web',
                            whatsapp_number: target.whatsapp_number || opened.external_whatsapp_number || '-',
                            User: {
                                id: target.id,
                                name: target.name
                            },
                            Messages: latest ? [latest] : [],
                            unread_count: 0
                        }];
                    }
                }
            }
        }
        if (status === 'active') {
            sessions = sessions.filter((row) => !row.Messages?.[0]?.body?.includes('!bot'));
        }

        const threadIds = sessions
            .map((row: any) => String(row.id || '').trim())
            .filter(Boolean);

        const unreadCountByThread = new Map<string, number>();
        if (threadIds.length > 0) {
            const unreadRows = await Message.findAll({
                attributes: [
                    'thread_id',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'unread_count']
                ],
                where: {
                    thread_id: { [Op.in]: threadIds },
                    read_at: { [Op.is]: null },
                    sender_type: { [Op.ne]: 'bot' },
                    [Op.or]: [
                        { sender_id: { [Op.ne]: actor.id } },
                        { sender_id: { [Op.is]: null as any } }
                    ]
                },
                group: ['thread_id'],
                raw: true,
            }) as unknown as Array<{ thread_id: string; unread_count: number | string }>;

            for (const row of unreadRows) {
                unreadCountByThread.set(String(row.thread_id), Number(row.unread_count || 0));
            }
        }

        sessions = sessions.map((row: any) => ({
            ...row,
            unread_count: unreadCountByThread.get(String(row.id || '')) || 0,
        }));

        const pendingTotal = sessions.reduce((acc, row: any) => {
            return acc + (Number(row.unread_count || 0) > 0 ? 1 : 0);
        }, 0);
        const pendingMessageTotal = sessions.reduce((acc, row: any) => {
            return acc + Number(row.unread_count || 0);
        }, 0);

        return res.json({
            total: sessions.length,
            pending_total: pendingTotal,
            pending_message_total: pendingMessageTotal,
            totalPages: 1,
            currentPage: 1,
            sessions
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError(error?.message || 'Error fetching sessions', 500);
    }
});

export const getMessages = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const requestedLimit = Number(req.query.limit || 50);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;

        const { thread } = await resolveThreadByIdOrLegacySession(id);
        const canAccess = await canAccessThread(thread, asActor(req));
        if (!canAccess) {
            throw new CustomError('Akses thread ditolak.', 403);
        }

        const result = await getThreadMessages({
            actor: asActor(req),
            threadId: thread.id,
            limit
        });

        const readResult = await markThreadAsRead({
            actor: asActor(req),
            threadId: thread.id
        });
        if (readResult.updated_count > 0) {
            emitThreadRead(thread.id, readResult.updated_count);
            await emitUnreadBadgeForThread({ threadId: thread.id });
        }

        return res.json({
            total: result.messages.length,
            messages: result.messages.map((row: any) => ({
                id: row.id,
                body: row.body,
                sender_type: row.sender_type,
                sender_id: row.sender_id,
                created_via: row.created_via,
                attachment_url: row.attachment_url,
                createdAt: row.createdAt,
                is_read: row.is_read,
                channel: row.channel,
                quoted_message: row.quoted_message || null
            }))
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError(error?.message || 'Error fetching messages', 500);
    }
});

export const replyToChat = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const quotedMessageId = String(req.body?.quoted_message_id || '').trim();
        const attachmentUrl = req.file
            ? `/uploads/chat/${path.basename(req.file.path)}`
            : '';
        const body = rawMessage || (attachmentUrl ? ATTACHMENT_FALLBACK_BODY : '');

        if (!body && !attachmentUrl) {
            throw new CustomError('Pesan atau lampiran wajib diisi.', 400);
        }

        const actor = asActor(req);
        const { thread, session } = await resolveThreadByIdOrLegacySession(id);
        const canAccess = await canAccessThread(thread, actor);
        if (!canAccess) {
            throw new CustomError('Anda tidak memiliki akses ke sesi chat ini.', 403);
        }

        let channel: ChatMessageChannel = 'app';
        if (isSupportRole(actor.role) && (thread.thread_type === 'support_omni' || thread.thread_type === 'wa_lead')) {
            const latestCustomer = await Message.findOne({
                where: {
                    thread_id: thread.id,
                    sender_type: 'customer'
                },
                order: [['id', 'DESC']],
                attributes: ['channel']
            });
            if (latestCustomer?.channel === 'whatsapp') {
                channel = 'whatsapp';
            }
        }
        if (req.body?.channel === 'whatsapp' && isSupportRole(actor.role)) {
            channel = 'whatsapp';
        }

        if (channel === 'whatsapp') {
            const targetNumber = await resolveWhatsappTargetForThread(thread);
            if (!targetNumber) {
                throw new CustomError('Target WhatsApp thread tidak valid.', 400);
            }
            await sendViaWhatsApp(targetNumber, {
                body: rawMessage,
                attachmentUrl: attachmentUrl || undefined
            });
        }

        const senderType = actor.role === 'customer' ? 'customer' : 'admin';
        const saved = await createThreadMessage({
            threadId: thread.id,
            senderType,
            senderId: actor.id,
            body,
            attachmentUrl: attachmentUrl || undefined,
            channel,
            quotedMessageId: quotedMessageId || undefined,
            sessionId: session?.id || undefined,
            isRead: false,
            deliveryState: channel === 'whatsapp' ? 'delivered' : 'sent'
        });

        emitThreadMessage({
            thread_id: thread.id,
            channel,
            body: saved.body,
            attachment_url: saved.attachment_url || undefined,
            sender: senderType,
            sender_id: saved.sender_id || undefined,
            timestamp: saved.createdAt
        });
        await emitUnreadBadgeForThread({ threadId: thread.id, excludeUserId: actor.id });

        return res.json({ message: 'Reply sent' });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError(error?.message || 'Error sending reply', 500);
    }
});

export const searchContacts = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const q = String(req.query.q || '').trim();
        const requestedLimit = Number(req.query.limit || 20);
        const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 20;

        const contacts = await listContacts({
            actor: asActor(req),
            type: 'staff',
            q,
            limit
        });

        return res.json({ contacts });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError(error?.message || 'Error searching contacts', 500);
    }
});
