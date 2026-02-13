import { Request, Response } from 'express';
import path from 'path';
import { ChatSession, Message, User, sequelize } from '../models';
import { handleAdminReply } from '../services/WhatsappService';
import { io } from '../server';
import waClient, { getStatus as getWhatsappStatus } from '../services/whatsappClient';
import { QueryTypes } from 'sequelize';

const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';

const isCreatedViaEnumError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (
        message.includes('created_via') &&
        (
            message.includes('incorrect enum value') ||
            message.includes('data truncated') ||
            message.includes('invalid input value for enum')
        )
    );
};

const createAdminMessageWithFallback = async (payload: {
    session_id: string;
    sender_id: string;
    body: string;
    attachment_url?: string;
    is_read?: boolean;
}) => {
    try {
        return await Message.create({
            ...payload,
            sender_type: 'admin',
            is_read: payload.is_read ?? true,
            created_via: 'admin_panel'
        });
    } catch (error) {
        if (!isCreatedViaEnumError(error)) throw error;
        return await Message.create({
            ...payload,
            sender_type: 'admin',
            is_read: payload.is_read ?? true,
            created_via: 'system'
        });
    }
};

export const getSessions = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20, status } = req.query; // status: 'active' (bot off), 'bot' (bot on), 'all'
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        if (status === 'active') {
            whereClause.is_bot_active = false;
        } else if (status === 'bot') {
            whereClause.is_bot_active = true;
        }

        const sessions = await ChatSession.findAndCountAll({
            where: whereClause,
            include: [
                { model: User, attributes: ['id', 'name', 'email'] },
                {
                    model: Message,
                    separate: true,
                    limit: 1,
                    order: [['createdAt', 'DESC']],
                    attributes: ['body', 'attachment_url', 'createdAt', 'is_read', 'sender_type']
                }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['last_message_at', 'DESC']]
        });

        const statusFilter = status === 'active' ? 'active' : status === 'bot' ? 'bot' : 'all';
        const pendingRows = await sequelize.query<{ total: number }>(
            `
                SELECT COUNT(*) AS total
                FROM chat_sessions cs
                INNER JOIN (
                    SELECT session_id, MAX(id) AS last_message_id
                    FROM messages
                    GROUP BY session_id
                ) lm_idx ON lm_idx.session_id = cs.id
                INNER JOIN messages lm ON lm.id = lm_idx.last_message_id
                WHERE lm.sender_type = 'customer'
                  AND lm.is_read = false
                  AND (:statusFilter <> 'active' OR cs.is_bot_active = false)
                  AND (:statusFilter <> 'bot' OR cs.is_bot_active = true)
            `,
            {
                replacements: { statusFilter },
                type: QueryTypes.SELECT
            }
        );
        const pendingTotal = Number(pendingRows[0]?.total || 0);

        res.json({
            total: sessions.count,
            pending_total: pendingTotal,
            totalPages: Math.ceil(sessions.count / Number(limit)),
            currentPage: Number(page),
            sessions: sessions.rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching sessions', error });
    }
};

export const getMessages = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // Session ID
        const { page = 1, limit = 50 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const messages = await Message.findAndCountAll({
            where: { session_id: id },
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']] // UI usually reverses this
        });

        // Mark as read if admin is viewing?
        // Maybe separate endpoint or flag?
        // Let's mark customer messages as read.
        const [updatedCount] = await Message.update(
            { is_read: true },
            {
                where: {
                    session_id: id,
                    sender_type: 'customer',
                    is_read: false
                }
            }
        );

        if (updatedCount > 0) {
            io.emit('chat:status', {
                session_id: id,
                action: 'marked_read',
                updated_count: updatedCount
            });
        }

        res.json({
            total: messages.count,
            messages: messages.rows.reverse() // Send chronological order
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching messages', error });
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

        const session = await ChatSession.findByPk(sessionId, {
            attributes: ['id', 'platform', 'whatsapp_number', 'user_id']
        });
        if (!session || session.platform !== 'web') {
            return res.status(404).json({ message: 'Sesi chat web tidak ditemukan.' });
        }

        // Jika sesi milik user login, wajib kirim user_id yang sesuai.
        if (session.user_id) {
            if (!requesterUserId || session.user_id !== requesterUserId) {
                return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
            }
        } else
        // Guard untuk sesi guest agar user lain tidak bisa menebak session_id.
        if (session.whatsapp_number?.startsWith('web-')) {
            if (!guestId || session.whatsapp_number !== `web-${guestId}`) {
                return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
            }
        } else {
            // Legacy sesi web tanpa user_id dan tanpa prefix guest tidak boleh diakses publik.
            return res.status(403).json({ message: 'Akses riwayat chat ditolak.' });
        }

        const messages = await Message.findAll({
            where: { session_id: session.id },
            attributes: ['id', 'body', 'attachment_url', 'sender_type', 'createdAt'],
            order: [['createdAt', 'ASC']],
            limit
        });

        return res.json({
            session_id: session.id,
            messages
        });
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching web chat history', error });
    }
};

export const replyToChat = async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // Session ID
        const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const attachmentUrl = req.file
            ? `/uploads/chat/${path.basename(req.file.path)}`
            : '';
        const adminId = req.user!.id;

        if (!rawMessage && !attachmentUrl) {
            return res.status(400).json({ message: 'Pesan atau lampiran wajib diisi.' });
        }
        const body = rawMessage || ATTACHMENT_FALLBACK_BODY;

        const session = await ChatSession.findByPk(String(id));
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        if (session.platform === 'whatsapp') {
            if (getWhatsappStatus() !== 'READY') {
                return res.status(409).json({
                    message: 'WhatsApp belum terhubung. Silakan Connect WhatsApp terlebih dahulu.'
                });
            }
            const emittedBody = rawMessage || ATTACHMENT_FALLBACK_BODY;
            await handleAdminReply(waClient, String(id), {
                body: rawMessage,
                attachmentUrl,
                adminId
            });
            io.emit('chat:message', {
                session_id: session.id,
                platform: 'whatsapp',
                body: emittedBody,
                attachment_url: attachmentUrl || undefined,
                sender: 'admin',
                timestamp: new Date()
            });
        } else {
            await session.update({
                is_bot_active: false,
                last_message_at: new Date()
            });

            const saved = await createAdminMessageWithFallback({
                session_id: session.id,
                sender_id: adminId,
                body,
                attachment_url: attachmentUrl || undefined,
                is_read: true
            });

            io.emit('chat:message', {
                session_id: session.id,
                platform: 'web',
                body: saved.body,
                attachment_url: saved.attachment_url,
                sender: 'admin',
                timestamp: saved.createdAt
            });
        }

        res.json({ message: 'Reply sent' });
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: `Error sending reply: ${detail}`, error });
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
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ message: `Gagal upload lampiran: ${detail}` });
    }
};
