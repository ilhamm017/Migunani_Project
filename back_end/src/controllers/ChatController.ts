import { Request, Response } from 'express';
import path from 'path';
import { MessageMedia } from 'whatsapp-web.js';
import { ChatSession, ChatThread, Message, User, sequelize } from '../models';
import {
    ChatActor,
    ChatMessageChannel,
    ContactQueryType,
    OpenThreadMode,
    ThreadScope,
    canAccessThread,
    createThreadMessage,
    getThreadMessages,
    listContacts,
    listThreads,
    markThreadAsRead,
    openThread,
    resolveStaffCustomerThread,
    resolveSupportOmniThread,
    resolveThreadForIncomingWebSocket,
    resolveThreadForLegacySession,
} from '../services/ChatThreadService';
import { io } from '../server';
import waClient, { getStatus as getWhatsappStatus } from '../services/whatsappClient';
import { normalizeWhatsappNumber } from '../utils/whatsappNumber';
import { Op } from 'sequelize';
import fs from 'fs';

const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';
const INTERNAL_STAFF_ROLES = ['super_admin', 'kasir', 'admin_gudang', 'admin_finance', 'driver'] as const;
const SUPPORT_ROLES = new Set(['super_admin', 'kasir']);
const isSupportRole = (role: string) => SUPPORT_ROLES.has(role);

const asActor = (req: Request): ChatActor => ({
    id: String(req.user?.id || ''),
    role: String(req.user?.role || ''),
    whatsapp_number: req.user?.whatsapp_number,
});

const mapChatServiceError = (res: Response, error: unknown): boolean => {
    const code = String((error as any)?.message || '');
    if (code === 'ACTOR_NOT_FOUND') {
        res.status(401).json({ message: 'Sesi tidak valid. Silakan login ulang.' });
        return true;
    }
    if (code === 'THREAD_NOT_FOUND') {
        res.status(404).json({ message: 'Thread tidak ditemukan.' });
        return true;
    }
    if (code === 'THREAD_FORBIDDEN') {
        res.status(403).json({ message: 'Akses thread ditolak.' });
        return true;
    }
    return false;
};

const emitThreadMessage = (payload: {
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

const emitThreadRead = (threadId: string, updatedCount: number) => {
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

const resolveThreadByIdOrLegacySession = async (value: string): Promise<{ thread: ChatThread; session?: ChatSession | null }> => {
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

const resolveWhatsappTargetForThread = async (thread: ChatThread): Promise<string | null> => {
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

const sendViaWhatsApp = async (targetNumber: string, payload: { body?: string; attachmentUrl?: string }) => {
    const textBody = String(payload.body || '').trim();
    const attachmentUrl = String(payload.attachmentUrl || '').trim();

    if (!textBody && !attachmentUrl) {
        throw new Error('Pesan atau lampiran wajib diisi.');
    }
    const chatId = `${targetNumber}@c.us`;
    if (attachmentUrl) {
        const absolutePath = path.resolve(process.cwd(), attachmentUrl.replace(/^\/+/, ''));
        if (!fs.existsSync(absolutePath)) {
            throw new Error('File lampiran tidak ditemukan di server.');
        }
        const media = await MessageMedia.fromFilePath(absolutePath);
        await waClient.sendMessage(chatId, media, textBody ? { caption: textBody } : undefined);
        return;
    }
    await waClient.sendMessage(chatId, textBody);
};

const toLegacySessionRow = (row: any) => {
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

export const getThreads = async (req: Request, res: Response) => {
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
        return res.status(500).json({ message: error?.message || 'Error fetching threads' });
    }
};

export const openChatThread = async (req: Request, res: Response) => {
    try {
        const mode = String(req.body?.mode || '').trim() as OpenThreadMode;
        const targetUserId = String(req.body?.target_user_id || '').trim();
        if (!mode || !['staff_dm', 'staff_customer', 'support'].includes(mode)) {
            return res.status(400).json({ message: 'Mode thread tidak valid.' });
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
        if (code === 'TARGET_NOT_FOUND') return res.status(404).json({ message: 'Target user tidak ditemukan.' });
        if (code === 'TARGET_REQUIRED') return res.status(400).json({ message: 'target_user_id wajib diisi.' });
        if (mapChatServiceError(res, error)) return;
        if (code.includes('FORBIDDEN') || code.startsWith('INVALID_') || code === 'SUPPORT_FORBIDDEN') {
            return res.status(403).json({ message: 'Anda tidak memiliki akses membuka thread ini.' });
        }
        return res.status(500).json({ message: error?.message || 'Error opening thread' });
    }
};

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

export const markThreadRead = async (req: Request, res: Response) => {
    try {
        const threadId = String(req.params.threadId || '').trim();
        const result = await markThreadAsRead({
            actor: asActor(req),
            threadId
        });
        if (result.updated_count > 0) {
            emitThreadRead(result.thread.id, result.updated_count);
        }
        return res.json({
            message: 'Thread marked as read',
            thread_id: result.thread.id,
            updated_count: result.updated_count
        });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error marking thread as read' });
    }
};

export const getThreadContacts = async (req: Request, res: Response) => {
    try {
        const type = String(req.query.type || 'staff').trim() as ContactQueryType;
        const q = String(req.query.q || '').trim();
        const requestedLimit = Number(req.query.limit || 20);
        const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.trunc(requestedLimit))) : 20;
        if (!['staff', 'customer_contextual'].includes(type)) {
            return res.status(400).json({ message: 'Tipe kontak tidak valid.' });
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
        return res.status(500).json({ message: error?.message || 'Error fetching contacts' });
    }
};

// Legacy endpoints (compatibility wrappers)
export const getSessions = async (req: Request, res: Response) => {
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
        return res.status(500).json({ message: error?.message || 'Error fetching sessions' });
    }
};

export const getMessages = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const requestedLimit = Number(req.query.limit || 50);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 50;

        const { thread } = await resolveThreadByIdOrLegacySession(id);
        const canAccess = await canAccessThread(thread, asActor(req));
        if (!canAccess) {
            return res.status(403).json({ message: 'Akses thread ditolak.' });
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
        return res.status(500).json({ message: error?.message || 'Error fetching messages' });
    }
};

export const replyToChat = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id || '').trim();
        const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const quotedMessageId = String(req.body?.quoted_message_id || '').trim();
        const attachmentUrl = req.file
            ? `/uploads/chat/${path.basename(req.file.path)}`
            : '';
        const body = rawMessage || (attachmentUrl ? ATTACHMENT_FALLBACK_BODY : '');

        if (!body && !attachmentUrl) {
            return res.status(400).json({ message: 'Pesan atau lampiran wajib diisi.' });
        }

        const actor = asActor(req);
        const { thread, session } = await resolveThreadByIdOrLegacySession(id);
        const canAccess = await canAccessThread(thread, actor);
        if (!canAccess) {
            return res.status(403).json({ message: 'Anda tidak memiliki akses ke sesi chat ini.' });
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

        return res.json({ message: 'Reply sent' });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error sending reply' });
    }
};

export const searchContacts = async (req: Request, res: Response) => {
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
        return res.status(500).json({ message: error?.message || 'Error searching contacts' });
    }
};

export const getMyWebSession = async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        if (!actor.id) {
            return res.status(401).json({ message: 'User tidak terautentikasi.' });
        }
        const user = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!user || user.role !== 'customer') {
            return res.status(403).json({ message: 'Endpoint hanya untuk customer.' });
        }

        const thread = await resolveSupportOmniThread(actor.id);
        return res.json({
            session: {
                id: thread.id,
                user_id: actor.id,
                whatsapp_number: thread.external_whatsapp_number || '',
                platform: 'web',
                last_message_at: thread.last_message_at
            }
        });
    } catch (error: any) {
        return res.status(500).json({ message: error?.message || 'Error resolving web session' });
    }
};

export const getMyWebSessionByStaff = async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        const staffId = String(req.query.staff_id || '').trim();
        if (!actor.id) {
            return res.status(401).json({ message: 'User tidak terautentikasi.' });
        }
        if (!staffId) {
            return res.status(400).json({ message: 'staff_id wajib diisi.' });
        }

        const requester = await User.findByPk(actor.id, {
            attributes: ['id', 'role']
        });
        if (!requester || requester.role !== 'customer') {
            return res.status(403).json({ message: 'Endpoint hanya untuk customer.' });
        }

        const staff = await User.findOne({
            where: {
                id: staffId,
                role: { [Op.in]: INTERNAL_STAFF_ROLES as unknown as string[] },
                status: 'active'
            },
            attributes: ['id', 'name', 'role', 'whatsapp_number']
        });
        if (!staff) {
            return res.status(404).json({ message: 'Staff tujuan tidak ditemukan.' });
        }

        let thread: ChatThread;
        if (staff.role === 'driver') {
            thread = await openThread({
                actor,
                mode: 'staff_customer',
                targetUserId: staff.id
            });
        } else if (staff.role === 'super_admin' || staff.role === 'kasir') {
            thread = await resolveSupportOmniThread(requester.id);
        } else {
            return res.status(403).json({ message: 'Customer hanya dapat chat ke support atau driver terkait.' });
        }

        const canAccess = await canAccessThread(thread, actor);
        if (!canAccess) {
            return res.status(403).json({ message: 'Akses chat ke staff ini ditolak.' });
        }

        return res.json({
            session: {
                id: thread.id,
                user_id: requester.id,
                whatsapp_number: staff.whatsapp_number,
                platform: 'web',
                last_message_at: thread.last_message_at
            },
            staff
        });
    } catch (error: any) {
        return res.status(500).json({ message: error?.message || 'Error resolving session by staff' });
    }
};

export const getMyWebSessions = async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        if (!actor.id) {
            return res.status(401).json({ message: 'User tidak terautentikasi.' });
        }
        const requester = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!requester || requester.role !== 'customer') {
            return res.status(403).json({ message: 'Endpoint hanya untuk customer.' });
        }

        const result = await listThreads({
            actor,
            limit: 200
        });
        const rows = result.threads.filter((row: any) =>
            row.thread_type === 'support_omni' || row.thread_type === 'staff_customer'
        );

        const sessions = rows.map((row: any) => ({
            id: row.id,
            user_id: requester.id,
            platform: 'web',
            whatsapp_number: row.subtitle || row.external_whatsapp_number || '',
            last_message_at: row.last_message_at,
            unread_count: Number(row.unread_count || 0),
            staff: row.thread_type === 'staff_customer'
                ? {
                    id: (function () {
                        const threadKey = String(row.thread_key || '');
                        const parts = threadKey.split(':');
                        return parts[1] || '';
                    })(),
                    name: row.title,
                    role: 'driver',
                    whatsapp_number: row.subtitle || ''
                }
                : {
                    id: 'support',
                    name: 'Tim Migunani Support',
                    role: 'kasir',
                    whatsapp_number: ''
                },
            latest_message: row.latest_message || null
        }));

        return res.json({ sessions });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error fetching web sessions' });
    }
};

export const getWebMessages = async (req: Request, res: Response) => {
    try {
        const sessionId = String(req.query.session_id || '').trim();
        const guestId = String(req.query.guest_id || '').trim();
        const requesterUserId = String(req.query.user_id || '').trim();
        const requestedLimit = Number(req.query.limit || 200);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 200;

        if (!sessionId) {
            return res.status(400).json({ message: 'session_id wajib diisi.' });
        }

        const { thread } = await resolveThreadByIdOrLegacySession(sessionId);
        const isGuestThread = thread.thread_type === 'wa_lead' && String(thread.external_whatsapp_number || '').startsWith('webguest:');

        if (requesterUserId) {
            const requester = await User.findByPk(requesterUserId, { attributes: ['id', 'role', 'whatsapp_number'] });
            if (!requester) {
                return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
            }
            const allowed = await canAccessThread(thread, {
                id: requester.id,
                role: requester.role,
                whatsapp_number: requester.whatsapp_number
            });
            if (!allowed) {
                return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
            }

            const result = await getThreadMessages({
                actor: {
                    id: requester.id,
                    role: requester.role,
                    whatsapp_number: requester.whatsapp_number
                },
                threadId: thread.id,
                limit
            });

            const readResult = await markThreadAsRead({
                actor: {
                    id: requester.id,
                    role: requester.role,
                    whatsapp_number: requester.whatsapp_number
                },
                threadId: thread.id
            });
            if (readResult.updated_count > 0) {
                emitThreadRead(thread.id, readResult.updated_count);
            }

            return res.json({
                session_id: thread.id,
                messages: result.messages
            });
        }

        if (isGuestThread) {
            const expectedGuest = String(thread.external_whatsapp_number || '').replace(/^webguest:/, '');
            if (!guestId || guestId !== expectedGuest) {
                return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
            }
            const rows = await Message.findAll({
                where: { thread_id: thread.id },
                attributes: ['id', 'body', 'attachment_url', 'sender_type', 'created_via', 'channel', 'createdAt'],
                order: [['createdAt', 'ASC']],
                limit
            });
            return res.json({
                session_id: thread.id,
                messages: rows
            });
        }

        return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        return res.status(500).json({ message: error?.message || 'Error fetching web messages' });
    }
};

export const uploadWebAttachment = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Lampiran tidak ditemukan.' });
        }

        const attachmentUrl = `/uploads/chat/${path.basename(req.file.path)}`;
        return res.status(201).json({
            attachment_url: attachmentUrl,
            original_name: req.file.originalname,
            mime_type: req.file.mimetype,
            size: req.file.size
        });
    } catch (error: any) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ message: `Gagal upload lampiran: ${detail}` });
    }
};

export const resolveSocketThread = async (params: {
    session?: ChatSession | null;
    incomingUserId?: string;
    incomingGuestId?: string;
    incomingWhatsappNumber?: string;
}) => {
    return await resolveThreadForIncomingWebSocket(params);
};
