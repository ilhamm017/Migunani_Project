import { Client, Message as WaMessage, MessageMedia } from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';
import { User, ChatSession, Message, Order, Product, sequelize } from '../models'; // Import models
import { Op } from 'sequelize';
import { io } from '../server'; // Import IO for socket events

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
        const isGroup = chat.isGroup;

        if (isGroup) return; // Ignore groups for now

        console.log(`📩 Message from ${senderNumber}: ${msg.body}`);

        // 1. Find or Create User (Customer)
        // We need to match by whatsapp_number.
        // Note: whatsapp-web.js uses '628...' format. Our DB should store same.

        let user = await User.findOne({ where: { whatsapp_number: senderNumber } });

        // If user doesn't exist, maybe create a temporary 'Guest' user or just proceed without User ID?
        // ChatSession needs User ID? Schema says User ID is Nullable.

        // 2. Find or Create Chat Session
        let session = await ChatSession.findOne({
            where: { whatsapp_number: senderNumber, platform: 'whatsapp' }
        });

        if (!session) {
            session = await ChatSession.create({
                user_id: user ? user.id : undefined, // user.id can be string or undefined. UUID
                whatsapp_number: senderNumber,
                platform: 'whatsapp',
                is_bot_active: true,
                last_message_at: new Date()
            });
        } else {
            // Update last active
            await session.update({ last_message_at: new Date() });

            // Logic: If expired (> 120 mins), re-enable bot?
            // This logic is usually handled by Cron or Check here.
            const timeout = 120 * 60 * 1000; // 120 mins
            if (new Date().getTime() - new Date(session.last_message_at).getTime() > timeout) {
                await session.update({ is_bot_active: true });
            }
        }

        // 3. Save Message to DB
        await Message.create({
            session_id: session.id,
            sender_type: 'customer',
            sender_id: user?.id,
            body: msg.body,
            is_read: false,
            created_via: 'wa_mobile_sync'
        });

        // 4. Emit to Socket (for Admin Dashboard)
        io.emit('chat:message', {
            session_id: session.id,
            body: msg.body,
            sender: 'customer',
            timestamp: new Date()
        });

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
        const textBody = typeof payload.body === 'string' ? payload.body.trim() : '';
        const attachmentUrl = typeof payload.attachmentUrl === 'string' ? payload.attachmentUrl.trim() : '';

        if (!textBody && !attachmentUrl) {
            throw new Error('Pesan atau lampiran wajib diisi.');
        }
        const persistedBody = textBody || ATTACHMENT_FALLBACK_BODY;

        // Send via WhatsApp
        const chatId = `${session.whatsapp_number}@c.us`;
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

        // Save to DB
        await createAdminMessageWithFallback({
            session_id: session.id,
            sender_id: payload.adminId,
            body: persistedBody,
            attachment_url: attachmentUrl || undefined
        });

        return { success: true };

    } catch (error) {
        console.error('Error sending reply:', error);
        throw error;
    }
};
