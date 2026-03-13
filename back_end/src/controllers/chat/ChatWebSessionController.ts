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
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getMyWebSession = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        if (!actor.id) {
            throw new CustomError('User tidak terautentikasi.', 401);
        }
        const user = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!user || user.role !== 'customer') {
            throw new CustomError('Endpoint hanya untuk customer.', 403);
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
        throw new CustomError(error?.message || 'Error resolving web session', 500);
    }
});

export const getMyWebSessionByStaff = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        const staffId = String(req.query.staff_id || '').trim();
        if (!actor.id) {
            throw new CustomError('User tidak terautentikasi.', 401);
        }
        if (!staffId) {
            throw new CustomError('staff_id wajib diisi.', 400);
        }

        const requester = await User.findByPk(actor.id, {
            attributes: ['id', 'role']
        });
        if (!requester || requester.role !== 'customer') {
            throw new CustomError('Endpoint hanya untuk customer.', 403);
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
            throw new CustomError('Staff tujuan tidak ditemukan.', 404);
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
            throw new CustomError('Customer hanya dapat chat ke support atau driver terkait.', 403);
        }

        const canAccess = await canAccessThread(thread, actor);
        if (!canAccess) {
            throw new CustomError('Akses chat ke staff ini ditolak.', 403);
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
        throw new CustomError(error?.message || 'Error resolving session by staff', 500);
    }
});

export const getMyWebSessions = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const actor = asActor(req);
        if (!actor.id) {
            throw new CustomError('User tidak terautentikasi.', 401);
        }
        const requester = await User.findByPk(actor.id, { attributes: ['id', 'role'] });
        if (!requester || requester.role !== 'customer') {
            throw new CustomError('Endpoint hanya untuk customer.', 403);
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
        throw new CustomError(error?.message || 'Error fetching web sessions', 500);
    }
});

export const getWebMessages = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const sessionId = String(req.query.session_id || '').trim();
        const guestId = String(req.query.guest_id || '').trim();
        const requesterUserId = String(req.query.user_id || '').trim();
        const requestedLimit = Number(req.query.limit || 200);
        const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.trunc(requestedLimit))) : 200;

        if (!sessionId) {
            throw new CustomError('session_id wajib diisi.', 400);
        }

        const { thread } = await resolveThreadByIdOrLegacySession(sessionId);
        const isGuestThread = thread.thread_type === 'wa_lead' && String(thread.external_whatsapp_number || '').startsWith('webguest:');

        if (requesterUserId) {
            const requester = await User.findByPk(requesterUserId, { attributes: ['id', 'role', 'whatsapp_number'] });
            if (!requester) {
                throw new CustomError('Akses riwayat chat ditolak.', 403);
            }
            const allowed = await canAccessThread(thread, {
                id: requester.id,
                role: requester.role,
                whatsapp_number: requester.whatsapp_number
            });
            if (!allowed) {
                throw new CustomError('Akses riwayat chat ditolak.', 403);
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
                throw new CustomError('Akses riwayat chat ditolak.', 403);
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

        throw new CustomError('Akses riwayat chat ditolak.', 403);
    } catch (error: any) {
        if (mapChatServiceError(res, error)) return;
        throw new CustomError(error?.message || 'Error fetching web messages', 500);
    }
});

export const uploadWebAttachment = asyncWrapper(async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            throw new CustomError('Lampiran tidak ditemukan.', 400);
        }

        const attachmentUrl = `/uploads/chat/${path.basename(req.file.path)}`;
        return res.status(201).json({
            attachment_url: attachmentUrl,
            original_name: req.file.originalname,
            mime_type: req.file.mimetype,
            size: req.file.size
        });
    } catch (error: any) {
        if (error instanceof CustomError) {
            throw error;
        }
        const detail = error instanceof Error ? error.message : 'Unknown error';
        throw new CustomError(`Gagal upload lampiran: ${detail}`, 500);
    }
});

export const resolveSocketThread = async (params: {
    session?: ChatSession | null;
    incomingUserId?: string;
    incomingGuestId?: string;
    incomingWhatsappNumber?: string;
}) => {
    return await resolveThreadForIncomingWebSocket(params);
};
