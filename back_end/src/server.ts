import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { sequelize, ChatSession, Message } from './models';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});
const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';
const CHAT_ATTACHMENT_URL_REGEX = /^\/uploads\/chat\/[a-zA-Z0-9._-]+$/;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// WhatsApp Client
import waClient, { startWhatsappClient } from './services/whatsappClient';
import { handleIncomingMessage } from './services/WhatsappService';

waClient.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
    io.emit('wa:qr', qr);
});

waClient.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    io.emit('wa:ready', true);
    io.emit('wa:status', 'READY');
});

waClient.on('authenticated', () => {
    io.emit('wa:status', 'AUTHENTICATED');
});

waClient.on('auth_failure', () => {
    io.emit('wa:status', 'AUTH_FAILURE');
});

waClient.on('disconnected', () => {
    io.emit('wa:status', 'DISCONNECTED');
});

waClient.on('message', async msg => {
    console.log('MESSAGE RECEIVED', msg);
    await handleIncomingMessage(msg);
});

// Socket.io Connection
io.on('connection', (socket) => {
    console.log('A user connected', socket.id);

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });

    // Handle client messages (from Web Widget)
    socket.on('client:message', async (data) => {
        try {
            const payload = data || {};
            const rawBody = typeof payload.message === 'string' ? payload.message.trim() : '';
            const rawAttachmentUrl = typeof payload.attachment_url === 'string'
                ? payload.attachment_url.trim()
                : '';
            const incomingUserId = typeof payload.user_id === 'string' && payload.user_id.trim()
                ? payload.user_id.trim()
                : undefined;
            const incomingGuestId = typeof payload.guest_id === 'string' && payload.guest_id.trim()
                ? payload.guest_id.trim()
                : undefined;
            const incomingWhatsappNumber = typeof payload.whatsapp_number === 'string' && payload.whatsapp_number.trim()
                ? payload.whatsapp_number.trim()
                : undefined;

            if (!rawBody && !rawAttachmentUrl) return;
            if (rawAttachmentUrl && !CHAT_ATTACHMENT_URL_REGEX.test(rawAttachmentUrl)) return;

            const body = rawBody || ATTACHMENT_FALLBACK_BODY;
            const attachmentUrl = rawAttachmentUrl || undefined;

            let session = null as any;
            const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
            if (sessionId) {
                session = await ChatSession.findByPk(sessionId);
            }

            if (session) {
                const hasSessionOwnerUser = typeof session.user_id === 'string' && session.user_id.trim().length > 0;
                if (hasSessionOwnerUser) {
                    if (!incomingUserId || session.user_id !== incomingUserId) {
                        session = null;
                    }
                } else if (typeof session.whatsapp_number === 'string' && session.whatsapp_number.startsWith('web-')) {
                    if (!incomingGuestId || session.whatsapp_number !== `web-${incomingGuestId}`) {
                        session = null;
                    }
                } else {
                    // Legacy session tanpa owner yang jelas dianggap tidak valid untuk reuse public.
                    session = null;
                }
            }

            if (!session) {
                const identity = incomingWhatsappNumber || `web-${incomingGuestId || socket.id}`;

                session = await ChatSession.create({
                    user_id: incomingUserId,
                    whatsapp_number: identity,
                    platform: 'web',
                    is_bot_active: false,
                    last_message_at: new Date()
                });
            } else {
                const updates: any = { last_message_at: new Date() };
                if (!session.user_id && incomingUserId) {
                    updates.user_id = incomingUserId;
                }
                await session.update(updates);
            }

            const saved = await Message.create({
                session_id: session.id,
                sender_type: 'customer',
                sender_id: incomingUserId,
                body,
                attachment_url: attachmentUrl,
                is_read: false,
                created_via: 'system'
            });

            socket.emit('client:session', { session_id: session.id });
            io.emit('chat:message', {
                session_id: session.id,
                platform: 'web',
                body: saved.body,
                attachment_url: saved.attachment_url,
                sender: 'customer',
                timestamp: saved.createdAt
            });
            io.emit('chat:alert', {
                sessionId: session.id,
                platform: 'web',
                message: 'New web chat message'
            });
        } catch (error) {
            console.error('Error handling client:message', error);
        }
    });
});

import inventoryRoutes from './routes/inventory';

import authRoutes from './routes/auth';
import orderRoutes from './routes/order';
import cartRoutes from './routes/cart';
import financeRoutes from './routes/finance';
import posRoutes from './routes/pos';
import driverRoutes from './routes/driver';
import chatRoutes from './routes/chat';
import whatsappRoutes from './routes/whatsapp';
import staffRoutes from './routes/staff';

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/admin/finance', financeRoutes);
app.use('/api/v1/pos', posRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/admin/staff', staffRoutes);
import catalogRoutes from './routes/catalog';

app.use('/api/v1/catalog', catalogRoutes); // Public Product Catalog
app.use('/api/v1', inventoryRoutes); // /api/v1/products, /api/v1/admin/inventory...

app.get('/', (req, res) => {
    res.send('Migunani Motor Backend Running');
});


const PORT = process.env.PORT || 5000;
const waAutoInit = process.env.WA_AUTO_INIT !== 'false';

const ORDER_STATUS_ENUM_VALUES = [
    'pending',
    'waiting_payment',
    'processing',
    'debt_pending',
    'shipped',
    'delivered',
    'completed',
    'canceled',
    'expired',
    'hold'
];

const ensureOrderStatusEnumReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'orders'
               AND COLUMN_NAME = 'status'`
        ) as any;

        const columnType = rows?.[0]?.columnType || '';
        if (typeof columnType === 'string' && columnType.includes('debt_pending')) return;

        const enumValuesSql = ORDER_STATUS_ENUM_VALUES.map((value) => `'${value}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE orders
             MODIFY COLUMN status ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'pending'`
        );
        console.log('Order status enum updated: added debt_pending');
    } catch (error) {
        console.error('Failed to ensure orders.status enum includes debt_pending:', error);
        throw error;
    }
};

const startServer = async () => {
    try {
        await sequelize.authenticate();
        await sequelize.sync();
        await ensureOrderStatusEnumReady();
        console.log('Database connected and synchronized');

        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

        if (waAutoInit) {
            startWhatsappClient().catch((error) => {
                console.error('WhatsApp initialization failed (API tetap jalan):', error);
            });
        } else {
            console.log('WhatsApp auto init disabled (WA_AUTO_INIT=false)');
        }
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

export { io, waClient };
