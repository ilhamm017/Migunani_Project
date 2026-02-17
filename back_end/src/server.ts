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
import { sequelize, ChatSession, ChatThread } from './models';
import { normalizeWhatsappNumber } from './utils/whatsappNumber';
import { createThreadMessage, resolveThreadForIncomingWebSocket } from './services/ChatThreadService';
import { ensureChatThreadSchema } from './services/chatSchema';
import { backfillLegacyChatSessionsToThreads } from './services/ChatThreadService';
import { acquireSchemaLock, SchemaLockError } from './utils/schemaLock';
import { TaxConfigService } from './services/TaxConfigService';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});

// Socket contract:
// - admin:refresh_badges => trigger badge refresh on admin surfaces
// - order:status_changed => order workflow notification across roles
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
            const incomingWhatsappNumber = normalizeWhatsappNumber(payload.whatsapp_number);

            if (!rawBody && !rawAttachmentUrl) return;
            if (rawAttachmentUrl && !CHAT_ATTACHMENT_URL_REGEX.test(rawAttachmentUrl)) return;

            const body = rawBody || ATTACHMENT_FALLBACK_BODY;
            const attachmentUrl = rawAttachmentUrl || undefined;

            let session = null as any;
            const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null;
            let directThread = null as any;
            if (sessionId) {
                session = await ChatSession.findByPk(sessionId);
                if (!session) {
                    directThread = await ChatThread.findByPk(sessionId);
                    if (directThread) {
                        const threadCustomerId = String(directThread.customer_user_id || '').trim();
                        const external = String(directThread.external_whatsapp_number || '').trim();
                        const guestAllowed = external.startsWith('webguest:') && incomingGuestId && external === `webguest:${incomingGuestId}`;
                        const userAllowed = !threadCustomerId || (incomingUserId && incomingUserId === threadCustomerId);
                        if (!guestAllowed && !userAllowed) {
                            directThread = null;
                        }
                    }
                }
            }

            const thread = directThread || await resolveThreadForIncomingWebSocket({
                session,
                incomingUserId,
                incomingGuestId,
                incomingWhatsappNumber: incomingWhatsappNumber || undefined
            });

            const saved = await createThreadMessage({
                threadId: thread.id,
                sessionId: session?.id || thread.id,
                senderType: 'customer',
                senderId: incomingUserId,
                body,
                attachmentUrl,
                channel: 'app',
                isRead: false,
                deliveryState: 'sent'
            });

            socket.emit('client:session', { session_id: thread.id });
            io.emit('chat:thread_message', {
                thread_id: thread.id,
                channel: 'app',
                body: saved.body,
                attachment_url: saved.attachment_url,
                sender: 'customer',
                sender_id: incomingUserId,
                timestamp: saved.createdAt
            });
            io.emit('chat:message', {
                session_id: thread.id,
                thread_id: thread.id,
                platform: 'web',
                body: saved.body,
                attachment_url: saved.attachment_url,
                sender: 'customer',
                sender_id: incomingUserId,
                timestamp: saved.createdAt
            });
            io.emit('chat:alert', {
                sessionId: thread.id,
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
// import posRoutes from './routes/pos';
import driverRoutes from './routes/driver';
import chatRoutes from './routes/chat';
import whatsappRoutes from './routes/whatsapp';
import staffRoutes from './routes/staff';
import stockOpnameRoutes from './routes/stockOpname';
import allocationRoutes from './routes/allocation';
import returRoutes from './routes/retur';
import customerRoutes from './routes/customer';
import shippingMethodRoutes from './routes/shippingMethod';
import discountVoucherRoutes from './routes/discountVoucher';
import accountRoutes from './routes/accounts';
import profileRoutes from './routes/profile';
import promoRoutes from './routes/promo';

// Routes
// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/admin/finance', financeRoutes);
// app.use('/api/v1/pos', posRoutes); // Removed
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/admin/staff', staffRoutes);
import catalogRoutes from './routes/catalog';

app.use('/api/v1/catalog', catalogRoutes); // Public Product Catalog
app.use('/api/v1', inventoryRoutes); // /api/v1/products, /api/v1/admin/inventory...
app.use('/api/v1/inventory/audit', stockOpnameRoutes);
app.use('/api/v1/allocation', allocationRoutes);
app.use('/api/v1/retur', returRoutes);
app.use('/api/v1/admin/customers', customerRoutes);
app.use('/api/v1/admin/shipping-methods', shippingMethodRoutes);
app.use('/api/v1/admin/discount-vouchers', discountVoucherRoutes);
app.use('/api/v1/admin/accounts', accountRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/promos', promoRoutes);

app.get('/', (req, res) => {
    res.send('Migunani Motor Backend Running');
});


const PORT = process.env.PORT || 5000;
const waAutoInit = process.env.WA_AUTO_INIT !== 'false';

const ORDER_STATUS_ENUM_VALUES = [
    'pending',
    'waiting_invoice',
    'waiting_payment',
    'ready_to_ship',
    'allocated',
    'partially_fulfilled',
    'debt_pending',
    'shipped',
    'delivered',
    'completed',
    'canceled',
    'expired',
    'hold',
    'waiting_admin_verification'
];

const RETUR_STATUS_ENUM_VALUES = [
    'pending',
    'approved',
    'pickup_assigned',
    'picked_up',
    'handed_to_warehouse',
    'received',
    'completed',
    'rejected'
];

const parseEnumValuesFromColumnType = (columnTypeRaw: unknown): string[] => {
    const columnType = String(columnTypeRaw || '');
    const values: string[] = [];
    const regex = /'((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(columnType)) !== null) {
        values.push(match[1].replace(/\\'/g, "'"));
    }
    return values;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runStartupStep = async (name: string, fn: () => Promise<void>) => {
    const startedAt = Date.now();
    console.log(`[Startup] ${name}...`);
    await fn();
    console.log(`[Startup] ${name} done (${Date.now() - startedAt}ms)`);
};

const isDeadlockError = (error: any): boolean => {
    const code = error?.parent?.code || error?.original?.code || error?.code;
    return code === 'ER_LOCK_DEADLOCK';
};

const tableExists = async (tableName: string): Promise<boolean> => {
    const [rows] = await sequelize.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tableName
         LIMIT 1`,
        {
            replacements: { tableName }
        }
    ) as any;

    return Array.isArray(rows) && rows.length > 0;
};

const ensureCriticalTablesReady = async () => {
    const criticalTables = ['users', 'orders'];

    let missingTables: string[] = [];
    for (const tableName of criticalTables) {
        const exists = await tableExists(tableName);
        if (!exists) missingTables.push(tableName);
    }

    if (missingTables.length === 0) return;

    console.warn(`Missing critical tables after alter sync: ${missingTables.join(', ')}. Running create-missing sync fallback.`);
    await sequelize.sync();

    const stillMissing: string[] = [];
    for (const tableName of criticalTables) {
        const exists = await tableExists(tableName);
        if (!exists) stillMissing.push(tableName);
    }

    if (stillMissing.length > 0) {
        throw new Error(`Critical tables are still missing after fallback sync: ${stillMissing.join(', ')}`);
    }
};

const syncDatabaseWithRetry = async () => {
    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await sequelize.sync({ alter: true });
            await ensureCriticalTablesReady();
            return;
        } catch (error) {
            lastError = error;
            if (isDeadlockError(error) && attempt < maxAttempts) {
                const delayMs = 1000 * attempt;
                console.warn(`Database sync deadlock on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms...`);
                await sleep(delayMs);
                continue;
            }

            console.error('Alter sync failed; attempting create-missing sync fallback:', error);
            await sequelize.sync();
            await ensureCriticalTablesReady();
            return;
        }
    }

    throw lastError || new Error('Database synchronization failed');
};

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

        const statusColumn = rows?.[0];
        if (!statusColumn) {
            // Fresh/partial schema bootstrap: skip enum alter until orders.status exists.
            console.warn('Skip order status enum update: orders.status column not found yet');
            return;
        }

        const columnType = statusColumn.columnType || '';
        // Check if new statuses exist. If 'allocated' and 'waiting_admin_verification' are missing, we need to run ALTER.
        if (typeof columnType === 'string' && columnType.includes('allocated') && columnType.includes('partially_fulfilled') && columnType.includes('waiting_admin_verification')) return;

        const enumValuesSql = ORDER_STATUS_ENUM_VALUES.map((value) => `'${value}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE orders
             MODIFY COLUMN status ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'pending'`
        );
        console.log('Order status enum updated: ensured latest values');
    } catch (error) {
        console.error('Failed to ensure orders.status enum values:', error);
        throw error;
    }
};

const ensureReturStatusEnumReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'returs'
               AND COLUMN_NAME = 'status'`
        ) as any;

        const statusColumn = rows?.[0];
        if (!statusColumn) {
            console.warn('Skip retur status enum update: returs.status column not found yet');
            return;
        }

        const currentValues = parseEnumValuesFromColumnType(statusColumn.columnType);
        const missingRequired = RETUR_STATUS_ENUM_VALUES.filter((value) => !currentValues.includes(value));
        if (missingRequired.length === 0) return;

        // Keep any legacy values already in DB to avoid ALTER failure from existing rows.
        const mergedValues = Array.from(new Set([...currentValues, ...RETUR_STATUS_ENUM_VALUES]));
        const enumValuesSql = mergedValues.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ');

        await sequelize.query(
            `ALTER TABLE returs
             MODIFY COLUMN status ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'pending'`
        );
        console.log(`Retur status enum updated: added [${missingRequired.join(', ')}]`);
    } catch (error) {
        console.error('Failed to ensure returs.status enum values:', error);
        throw error;
    }
};

const startServer = async () => {
    try {
        let retries = 10;
        while (retries) {
            try {
                await sequelize.authenticate();
                console.log('Database connection established successfully.');
                break;
            } catch (err) {
                console.log(`Database connection failed. Retries left: ${retries}. Retrying in 5 seconds...`);
                retries -= 1;
                await new Promise(res => setTimeout(res, 5000));
                if (retries === 0) throw err;
            }
        }
        let schemaLock: Awaited<ReturnType<typeof acquireSchemaLock>> | null = null;
        try {
            console.log('[SchemaLock] Waiting to acquire schema lock...');
            schemaLock = await acquireSchemaLock(sequelize);
            console.log(`[SchemaLock] Acquired '${schemaLock.lockName}'`);

            await runStartupStep('Database sync', syncDatabaseWithRetry);
            await runStartupStep('Ensure orders.status enum', ensureOrderStatusEnumReady);
            await runStartupStep('Ensure returs.status enum', ensureReturStatusEnumReady);
            await runStartupStep('Ensure default tax config', TaxConfigService.ensureDefaults);
            await runStartupStep('Ensure chat thread schema', ensureChatThreadSchema);
            await runStartupStep('Backfill legacy chat sessions', backfillLegacyChatSessionsToThreads);
        } catch (error: any) {
            if (error instanceof SchemaLockError && error.code === 'SCHEMA_LOCK_TIMEOUT') {
                throw new Error(
                    `Schema lock busy. Another schema operation is running. (${error.message})`
                );
            }
            throw error;
        } finally {
            if (schemaLock) {
                try {
                    await schemaLock.release();
                    console.log(`[SchemaLock] Released '${schemaLock.lockName}'`);
                } catch (releaseError) {
                    console.warn('[SchemaLock] Failed to release lock:', releaseError);
                }
            }
        }

        console.log('Database connected and synchronized successfully (schema enum checks applied)');

        httpServer.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

        if (waAutoInit) {
            // Check if we have a valid session in DB
            const { Setting } = require('./models');
            const waSession = await Setting.findByPk('whatsapp_session');
            const sessionData = waSession?.value;
            const isPreviouslyConnected = sessionData?.status === 'CONNECTED';

            if (isPreviouslyConnected) {
                console.log('[WA] Previous session found, attempting auto-reconnect...');
                startWhatsappClient().catch((error) => {
                    console.error('WhatsApp auto-reconnect failed:', error);
                });
            } else {
                console.log('[WA] No active session found. Manual start required via Admin Dashboard.');
            }
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
