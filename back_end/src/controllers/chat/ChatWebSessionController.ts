import { Request, Response } from 'express';
import { Op } from 'sequelize';
import path from 'path';
import { ChatSession, ChatThread, Message, User } from '../../models';
import {
    canAccessThread,
    getThreadMessages,
    listThreads,
    markThreadAsRead,
    openThread,
    resolveSupportOmniThread,
    resolveThreadForIncomingWebSocket
} from '../../services/ChatThreadService';
import {
    INTERNAL_STAFF_ROLES,
    asActor,
    emitThreadRead,
    emitUnreadBadgeForThread,
    mapChatServiceError,
    resolveThreadByIdOrLegacySession
} from './utils';

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
                await emitUnreadBadgeForThread({ threadId: thread.id });
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
