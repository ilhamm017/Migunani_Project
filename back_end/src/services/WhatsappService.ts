import { Client, Message as WaMessage, MessageMedia } from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';
import { User, ChatSession, Message, Order } from '../models';
import { Op } from 'sequelize';
import { io } from '../server'; // Import IO for socket events
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../utils/whatsappNumber';
import {
    createThreadMessage,
    resolveThreadForIncomingWhatsapp,
    resolveThreadForLegacySession
} from './ChatThreadService';
import { buildUnreadBadgePayloadsForThread } from './ChatBadgeService';

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
}) => {
    try {
        return await Message.create({
            ...payload,
            sender_type: 'admin',
            is_read: true,
            created_via: 'admin_panel'
        });
    } catch (error) {
        if (!isCreatedViaEnumError(error)) throw error;
        return await Message.create({
            ...payload,
            sender_type: 'admin',
            is_read: true,
            created_via: 'system'
        });
    }
};

// Bot Logic
const handleBotCommands = async (msg: WaMessage, session: ChatSession) => {
    const body = msg.body.trim();
    const lowerBody = body.toLowerCase();

    // 1. !help or Hello
    if (lowerBody === '!help' || lowerBody === 'hi' || lowerBody === 'halo' || lowerBody === 'menu') {
        await msg.reply(
            `👋 Halo! Selamat datang di Migunani Motor.\n\n` +
            `Saya Bot Asisten. Berikut perintah yang bisa Anda gunakan:\n` +
            `✅ *!order* - Cara pemesanan\n` +
            `✅ *!status [No.Order]* - Cek status pesanan (Contoh: !status 1001)\n` +
            `✅ *!admin* - Bicara dengan Admin (Live Chat)\n\n` +
            `Ketik pesan Anda, Admin kami akan segera membalas jika tersedia.`
        );
        return;
    }

    // 2. !order
    if (lowerBody === '!order') {
        await msg.reply(
            `🛒 *Cara Pemesanan:*\n\n` +
            `1. Kunjungi website kami di [Link Website]\n` +
            `2. Pilih produk dan checkout.\n` +
            `3. Lakukan pembayaran dan upload bukti transfer.\n\n` +
            `Atau kunjungi toko kami langsung di [Alamat Toko].`
        );
        return;
    }

    // 3. !status [Order ID] (Simplified to use Auto-Increment ID if we had it, but we use UUID. Maybe search by partial UUID or need Invoice Number?)
    // Let's assume Invoice Number for ease: "INV/..." or just last 4 digits?
    // User might not know UUID. Let's try searching by exact Invoice Number first.
    if (lowerBody.startsWith('!status')) {
        const query = body.split(' ')[1];
        if (!query) {
            await msg.reply(`⚠️ Harap sertakan Nomor Order/Invoice.\nContoh: *!status INV/202310/1234*`);
            return;
        }

        // Try to find by Invoice Number
        // We need to import Invoice model.
        const { Invoice } = require('../models');
        const invoice = await Invoice.findOne({
            where: { invoice_number: query },
            include: [{ model: Order }]
        });

        if (invoice && invoice.Order) {
            const order = invoice.Order;
            await msg.reply(
                `📦 *Status Pesanan*\n` +
                `No. Invoice: ${invoice.invoice_number}\n` +
                `Status: *${order.status.toUpperCase()}*\n` +
                `Pembayaran: ${invoice.payment_status.toUpperCase()}\n\n` +
                `Terima kasih sudah berbelanja!`
            );
        } else {
            await msg.reply(`❌ Pesanan dengan nomor *${query}* tidak ditemukan.`);
        }
        return;
    }

    // 4. !admin (Chat Takeover)
    if (lowerBody === '!admin') {
        await session.update({ is_bot_active: false });
        await msg.reply(`👨‍💻 *Mode Admin Aktif*\nBot dimatikan. Silakan tunggu balasan dari Admin kami.`);
        // Emit to admin dashboard
        io.emit('chat:alert', { message: 'Customer requesting admin!', sessionId: session.id });
        return;
    }

    // Default: Check if Bot is Active
    if (session.is_bot_active) {
        // Simple auto-reply for unknown commands
        // Or AI integration here (Gemini/OpenAI) if requested. 
        // For now, silent or generic fallback.
        // Let's send menu if it's the first message in a while? 
        // Or just nothing to avoid spam.
        // msg.reply('Ketik *!help* untuk menu bantuan.');
    }
};

export const handleIncomingMessage = async (msg: WaMessage) => {
    try {
        const contact = await msg.getContact();
        const chat = await msg.getChat();
        const senderNumber = contact.number; // e.g. 628123456789
        const normalizedSenderNumber = normalizeWhatsappNumber(senderNumber);
        const isGroup = chat.isGroup;

        if (isGroup) return; // Ignore groups for now
        if (!normalizedSenderNumber) return;

        console.log(`📩 Message from ${normalizedSenderNumber}: ${msg.body}`);
        const whatsappCandidates = getWhatsappLookupCandidates(normalizedSenderNumber);

        // 1. Find or Create User (Customer)
        // We need to match by whatsapp_number.
        // Note: whatsapp-web.js uses '628...' format. Our DB should store same.

        let user = await User.findOne({
            where: { whatsapp_number: { [Op.in]: whatsappCandidates } }
        });

        // If user doesn't exist, maybe create a temporary 'Guest' user or just proceed without User ID?
        // ChatSession needs User ID? Schema says User ID is Nullable.

        // 2. Find or Create Chat Session (khusus kanal WhatsApp)
        let session: ChatSession | null = null;
        if (user?.id) {
            session = await ChatSession.findOne({
                where: {
                    user_id: user.id,
                    platform: 'whatsapp'
                },
                order: [['last_message_at', 'DESC']]
            });
        }
        if (!session) {
            session = await ChatSession.findOne({
                where: {
                    whatsapp_number: { [Op.in]: whatsappCandidates },
                    platform: 'whatsapp'
                },
                order: [['last_message_at', 'DESC']]
            });
        }

        if (!session) {
            session = await ChatSession.create({
                user_id: user ? user.id : undefined, // user.id can be string or undefined. UUID
                whatsapp_number: normalizedSenderNumber,
                platform: 'whatsapp',
                is_bot_active: true,
                last_message_at: new Date()
            });
        } else {
            // Update last active
            const updates: Partial<{ last_message_at: Date; whatsapp_number: string; user_id: string }> = {
                last_message_at: new Date()
            };
            if (!session.user_id && user?.id) {
                updates.user_id = user.id;
            }
            if (session.whatsapp_number !== normalizedSenderNumber) {
                updates.whatsapp_number = normalizedSenderNumber;
            }
            await session.update(updates);

            // Logic: If expired (> 120 mins), re-enable bot?
            // This logic is usually handled by Cron or Check here.
            const timeout = 120 * 60 * 1000; // 120 mins
            if (new Date().getTime() - new Date(session.last_message_at).getTime() > timeout) {
                await session.update({ is_bot_active: true });
            }
        }

        const thread = await resolveThreadForIncomingWhatsapp({
            normalizedWhatsappNumber: normalizedSenderNumber,
            user
        });

        // 3. Save Message to DB
        const saved = await createThreadMessage({
            threadId: thread.id,
            sessionId: session.id,
            senderType: 'customer',
            senderId: user?.id,
            body: msg.body,
            channel: 'whatsapp',
            isRead: false,
            deliveryState: 'sent',
            createdVia: 'wa_mobile_sync'
        });

        // 4. Emit to Socket (for Admin Dashboard)
        io.emit('chat:thread_message', {
            thread_id: thread.id,
            channel: 'whatsapp',
            body: msg.body,
            sender: 'customer',
            sender_id: saved.sender_id || user?.id || undefined,
            timestamp: saved.createdAt
        });
        io.emit('chat:message', {
            session_id: thread.id,
            thread_id: thread.id,
            platform: 'whatsapp',
            body: msg.body,
            sender: 'customer',
            sender_id: saved.sender_id || user?.id || undefined,
            timestamp: saved.createdAt
        });
        const unreadBadgePayloads = await buildUnreadBadgePayloadsForThread({
            threadId: thread.id,
            excludeUserId: user?.id
        });
        for (const payload of unreadBadgePayloads) {
            io.emit('chat:unread_badge_updated', payload);
        }

        // 5. Bot Logic
        if (session.is_bot_active) {
            await handleBotCommands(msg, session);
        }

    } catch (error) {
        console.error('Error handling WA message:', error);
    }
};

export const handleAdminReply = async (client: Client, sessionId: string, payload: {
    body?: string;
    attachmentUrl?: string;
    adminId: string;
}) => {
    // Used when Admin replies from Dashboard
    try {
        const session = await ChatSession.findByPk(sessionId);
        if (!session) throw new Error('Session not found');
        const normalizedSessionNumber = normalizeWhatsappNumber(session.whatsapp_number);
        if (!normalizedSessionNumber) {
            throw new Error('Nomor WhatsApp pada sesi tidak valid.');
        }
        const textBody = typeof payload.body === 'string' ? payload.body.trim() : '';
        const attachmentUrl = typeof payload.attachmentUrl === 'string' ? payload.attachmentUrl.trim() : '';

        if (!textBody && !attachmentUrl) {
            throw new Error('Pesan atau lampiran wajib diisi.');
        }
        const persistedBody = textBody || ATTACHMENT_FALLBACK_BODY;

        // Send via WhatsApp
        const chatId = `${normalizedSessionNumber}@c.us`;
        if (session.whatsapp_number !== normalizedSessionNumber) {
            await session.update({ whatsapp_number: normalizedSessionNumber });
        }
        if (attachmentUrl) {
            const absolutePath = path.resolve(process.cwd(), attachmentUrl.replace(/^\/+/, ''));
            if (!fs.existsSync(absolutePath)) {
                throw new Error('File lampiran tidak ditemukan di server.');
            }
            const media = await MessageMedia.fromFilePath(absolutePath);
            await client.sendMessage(chatId, media, textBody ? { caption: textBody } : undefined);
        } else {
            await client.sendMessage(chatId, textBody);
        }

        // Pause Bot
        await session.update({
            is_bot_active: false,
            last_message_at: new Date()
        });

        const thread = await resolveThreadForLegacySession(session);

        // Save to DB
        await createThreadMessage({
            threadId: thread.id,
            sessionId: session.id,
            senderType: 'admin',
            senderId: payload.adminId,
            body: persistedBody,
            attachmentUrl: attachmentUrl || undefined,
            channel: 'whatsapp',
            isRead: false,
            deliveryState: 'delivered',
            createdVia: 'admin_panel'
        });

        return { success: true };

    } catch (error) {
        console.error('Error sending reply:', error);
        throw error;
    }
};
