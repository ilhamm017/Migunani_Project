import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { sequelize, ChatSession, ChatThread, Order } from './models';
import { normalizeWhatsappNumber } from './utils/whatsappNumber';
import { createThreadMessage, resolveThreadForIncomingWebSocket } from './services/ChatThreadService';
import { buildUnreadBadgePayloadsForThread } from './services/ChatBadgeService';
import { ensureChatThreadSchema } from './services/chatSchema';
import { backfillLegacyChatSessionsToThreads } from './services/ChatThreadService';
import { acquireSchemaLock, SchemaLockError } from './utils/schemaLock';
import { TaxConfigService } from './services/TaxConfigService';
import { startNotificationOutboxWorker } from './services/TransactionNotificationOutboxService';
import { auditLogMiddleware } from './middleware/auditLogMiddleware';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Adjust for production
        methods: ["GET", "POST"]
    }
});

// Prevent API responses from being revalidated as 304 (axios treats 304 as error),
// and avoid stale admin dashboards due to browser caching.
app.disable('etag');
app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
});

// Socket contract:
// - admin:refresh_badges => trigger badge refresh on admin surfaces
// - order:status_changed => order workflow notification across roles
// - retur:status_changed => retur workflow notification across roles
// - cod:settlement_updated => COD settlement update notification
// - chat:unread_badge_updated => unread chat badge update per user
const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';
const CHAT_ATTACHMENT_URL_REGEX = /^\/uploads\/chat\/[a-zA-Z0-9._-]+$/;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(auditLogMiddleware);

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
            const unreadBadgePayloads = await buildUnreadBadgePayloadsForThread({
                threadId: thread.id,
                excludeUserId: incomingUserId
            });
            for (const payload of unreadBadgePayloads) {
                io.emit('chat:unread_badge_updated', payload);
            }
        } catch (error) {
            console.error('Error handling client:message', error);
        }
    });
});

import inventoryRoutes from './routes/inventory';
import clearancePromoRoutes from './routes/clearancePromos';

import authRoutes from './routes/auth';
import orderRoutes from './routes/order';
import cartRoutes from './routes/cart';
import financeRoutes from './routes/finance';
import invoiceRoutes from './routes/invoice';
import posRoutes from './routes/pos';
import driverRoutes from './routes/driver';
import chatRoutes from './routes/chat';
import whatsappRoutes from './routes/whatsapp';
import staffRoutes from './routes/staff';
import stockOpnameRoutes from './routes/stockOpname';
import allocationRoutes from './routes/allocation';
import returRoutes from './routes/retur';
import driverDepositRoutes from './routes/driverDeposit';
import deliveryHandoverRoutes from './routes/deliveryHandover';
import customerRoutes from './routes/customer';
import shippingMethodRoutes from './routes/shippingMethod';
import publicShippingMethodRoutes from './routes/publicShippingMethod';
import discountVoucherRoutes from './routes/discountVoucher';
import accountRoutes from './routes/accounts';
import profileRoutes from './routes/profile';
import promoRoutes from './routes/promo';
import procurementRoutes from './routes/procurement';

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/admin/finance', financeRoutes);
app.use('/api/v1/admin/pos', posRoutes);
app.use('/api/v1/driver', driverRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/admin/staff', staffRoutes);
import catalogRoutes from './routes/catalog';

app.use('/api/v1/catalog', catalogRoutes); // Public Product Catalog
app.use('/api/v1', inventoryRoutes); // /api/v1/products, /api/v1/admin/inventory...
app.use('/api/v1', clearancePromoRoutes); // /api/v1/clearance-promos, /api/v1/admin/clearance-promos
app.use('/api/v1', procurementRoutes); // /api/v1/admin/procurement...
app.use('/api/v1/inventory/audit', stockOpnameRoutes);
app.use('/api/v1/allocation', allocationRoutes);
app.use('/api/v1/retur', returRoutes);
app.use('/api/v1/admin/driver-deposit', driverDepositRoutes);
app.use('/api/v1/admin/delivery-handovers', deliveryHandoverRoutes);
app.use('/api/v1/admin/customers', customerRoutes);
app.use('/api/v1/admin/shipping-methods', shippingMethodRoutes);
app.use('/api/v1/shipping-methods', publicShippingMethodRoutes);
app.use('/api/v1/admin/discount-vouchers', discountVoucherRoutes);
app.use('/api/v1/admin/accounts', accountRoutes);
app.use('/api/v1/profile', profileRoutes);
app.use('/api/v1/promos', promoRoutes);

app.get('/', (req, res) => {
    res.send('Migunani Motor Backend Running');
});

// Import and register centralized error handling middleware
import { errorMiddleware } from './middleware/errorMiddleware';
app.use(errorMiddleware);

const PORT = process.env.PORT || 5000;
const waAutoInit = process.env.WA_AUTO_INIT !== 'false';

const ORDER_STATUS_ENUM_VALUES = [
    'pending',
    'waiting_invoice',
    'waiting_payment',
    'ready_to_ship',
    'checked',
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

const ORDER_EVENT_TYPE_ENUM_VALUES = [
    'allocation_set',
    'invoice_issued',
    'invoice_item_billed',
    'driver_assigned',
    'backorder_opened',
    'backorder_reallocated',
    'backorder_canceled',
    'order_item_canceled',
    'order_canceled',
    'order_pricing_adjusted',
    'warehouse_checked',
    'warehouse_handed_over',
    'order_status_changed'
];

const INVOICE_SHIPMENT_STATUS_ENUM_VALUES = [
    'ready_to_ship',
    'checked',
    'shipped',
    'delivered',
    'canceled'
];

const USER_ROLE_ENUM_VALUES = [
    'super_admin',
    'admin_gudang',
    'checker_gudang',
    'admin_finance',
    'kasir',
    'driver',
    'customer'
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

type DbSyncMode = 'alter' | 'safe' | 'off';

const resolveDbSyncMode = (): DbSyncMode => {
    const rawMode = String(process.env.DB_SYNC_MODE || 'safe').trim().toLowerCase();
    if (rawMode === 'safe' || rawMode === 'off' || rawMode === 'alter') return rawMode;
    console.warn(`[Startup] Unknown DB_SYNC_MODE='${rawMode}', fallback to 'safe'`);
    return 'safe';
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

const columnExists = async (tableName: string, columnName: string): Promise<boolean> => {
    if (sequelize.getDialect() !== 'mysql') return true;
    const [rows] = await sequelize.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tableName
           AND COLUMN_NAME = :columnName
         LIMIT 1`,
        { replacements: { tableName, columnName } }
    ) as any;
    return Array.isArray(rows) && rows.length > 0;
};

const indexExists = async (tableName: string, indexName: string): Promise<boolean> => {
    if (sequelize.getDialect() !== 'mysql') return true;
    const [rows] = await sequelize.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tableName
           AND INDEX_NAME = :indexName
         LIMIT 1`,
        { replacements: { tableName, indexName } }
    ) as any;
    return Array.isArray(rows) && rows.length > 0;
};

const indexOnColumnExists = async (tableName: string, columnName: string): Promise<boolean> => {
    if (sequelize.getDialect() !== 'mysql') return true;
    const [rows] = await sequelize.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tableName
           AND COLUMN_NAME = :columnName
         LIMIT 1`,
        { replacements: { tableName, columnName } }
    ) as any;
    return Array.isArray(rows) && rows.length > 0;
};

const ensureReportIndexesReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    type IndexSpec = { table: string; indexName: string; columns: string[]; createSql: string };
    const specs: IndexSpec[] = [
        {
            table: 'invoices',
            indexName: 'idx_invoices_payment_verified_at',
            columns: ['payment_status', 'verified_at'],
            createSql: 'CREATE INDEX `idx_invoices_payment_verified_at` ON `invoices` (`payment_status`, `verified_at`)',
        },
        {
            table: 'invoices',
            indexName: 'idx_invoices_customer_payment_verified_at',
            columns: ['customer_id', 'payment_status', 'verified_at'],
            createSql: 'CREATE INDEX `idx_invoices_customer_payment_verified_at` ON `invoices` (`customer_id`, `payment_status`, `verified_at`)',
        },
        {
            table: 'pos_sales',
            indexName: 'idx_pos_sales_status_paid_at',
            columns: ['status', 'paid_at'],
            createSql: 'CREATE INDEX `idx_pos_sales_status_paid_at` ON `pos_sales` (`status`, `paid_at`)',
        },
        {
            table: 'pos_sales',
            indexName: 'idx_pos_sales_customer_status_paid_at',
            columns: ['customer_id', 'status', 'paid_at'],
            createSql: 'CREATE INDEX `idx_pos_sales_customer_status_paid_at` ON `pos_sales` (`customer_id`, `status`, `paid_at`)',
        },
        {
            table: 'pos_sale_items',
            indexName: 'idx_pos_sale_items_sale_product',
            columns: ['pos_sale_id', 'product_id'],
            createSql: 'CREATE INDEX `idx_pos_sale_items_sale_product` ON `pos_sale_items` (`pos_sale_id`, `product_id`)',
        },
    ];

    for (const spec of specs) {
        const exists = await tableExists(spec.table);
        if (!exists) continue;
        const hasColumns = await Promise.all(spec.columns.map((col) => columnExists(spec.table, col)));
        if (hasColumns.some((ok) => !ok)) continue;

        const already = await indexExists(spec.table, spec.indexName);
        if (already) continue;

        console.warn(`[Startup] Missing index on ${spec.table}: ${spec.indexName}. Applying CREATE INDEX...`);
        try {
            await sequelize.query(spec.createSql);
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_KEYNAME') continue;
            throw error;
        }
    }
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

const ensureInboundCostVarianceColumnsReady = async () => {
    const tableName = 'purchase_order_items';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const requiredColumns = ['expected_unit_cost', 'cost_note'];
    const missing: string[] = [];
    for (const columnName of requiredColumns) {
        const ok = await columnExists(tableName, columnName);
        if (!ok) missing.push(columnName);
    }

    if (missing.length === 0) return;

    console.warn(`[Startup] Missing columns in ${tableName}: ${missing.join(', ')}. Applying targeted ALTER TABLE...`);

    const addColumn = async (columnName: string, sqlType: string) => {
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${sqlType}`
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_FIELDNAME') return;
            throw error;
        }
    };

    if (missing.includes('expected_unit_cost')) {
        await addColumn('expected_unit_cost', 'DECIMAL(15, 2) NULL');
    }
    if (missing.includes('cost_note')) {
        await addColumn('cost_note', 'TEXT NULL');
    }
};

const ensureReturHandoverDebtSnapshotColumnsReady = async () => {
    const tableName = 'retur_handovers';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const requiredColumns = ['driver_debt_before', 'driver_debt_after'] as const;
    const missing: string[] = [];
    for (const columnName of requiredColumns) {
        const ok = await columnExists(tableName, columnName);
        if (!ok) missing.push(columnName);
    }

    if (missing.length === 0) return;

    console.warn(`[Startup] Missing columns in ${tableName}: ${missing.join(', ')}. Applying targeted ALTER TABLE...`);

    const addColumn = async (columnName: string, sqlType: string) => {
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${sqlType}`
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_FIELDNAME') return;
            throw error;
        }
    };

    // Add in order so AFTER clause is valid.
    if (missing.includes('driver_debt_before')) {
        await addColumn('driver_debt_before', 'DECIMAL(15, 2) NULL AFTER `note`');
    }
    if (missing.includes('driver_debt_after')) {
        await addColumn('driver_debt_after', 'DECIMAL(15, 2) NULL AFTER `driver_debt_before`');
    }
};

const ensureCodSettlementAuditColumnsReady = async () => {
    const tableName = 'cod_settlements';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const requiredColumns = [
        'total_expected',
        'diff_amount',
        'driver_debt_before',
        'driver_debt_after',
        'invoice_ids_json',
    ] as const;

    const missing: string[] = [];
    for (const columnName of requiredColumns) {
        const ok = await columnExists(tableName, columnName);
        if (!ok) missing.push(columnName);
    }

    if (missing.length === 0) return;

    console.warn(`[Startup] Missing columns in ${tableName}: ${missing.join(', ')}. Applying targeted ALTER TABLE...`);

    const addColumn = async (columnName: string, sqlType: string) => {
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${sqlType}`
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_FIELDNAME') return;
            throw error;
        }
    };

    if (missing.includes('total_expected')) {
        await addColumn('total_expected', 'DECIMAL(15, 2) NULL AFTER `total_amount`');
    }
    if (missing.includes('diff_amount')) {
        await addColumn('diff_amount', 'DECIMAL(15, 2) NULL AFTER `total_expected`');
    }
    if (missing.includes('driver_debt_before')) {
        await addColumn('driver_debt_before', 'DECIMAL(15, 2) NULL AFTER `diff_amount`');
    }
    if (missing.includes('driver_debt_after')) {
        await addColumn('driver_debt_after', 'DECIMAL(15, 2) NULL AFTER `driver_debt_before`');
    }
    if (missing.includes('invoice_ids_json')) {
        await addColumn('invoice_ids_json', 'TEXT NULL AFTER `driver_debt_after`');
    }
};

const ensureOrderPricingOverrideColumnsReady = async () => {
    const tableName = 'orders';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const requiredColumns = ['pricing_override_note'] as const;
    const missing: string[] = [];
    for (const columnName of requiredColumns) {
        const ok = await columnExists(tableName, columnName);
        if (!ok) missing.push(columnName);
    }

    if (missing.length === 0) return;

    console.warn(`[Startup] Missing columns in ${tableName}: ${missing.join(', ')}. Applying targeted ALTER TABLE...`);

    const addColumn = async (columnName: string, sqlType: string) => {
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${sqlType}`
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_FIELDNAME') return;
            throw error;
        }
    };

    if (missing.includes('pricing_override_note')) {
        await addColumn('pricing_override_note', 'TEXT NULL AFTER `discount_amount`');
    }
};

const ensureDeliveryHandoverItemEvidenceColumnsReady = async () => {
    const tableName = 'delivery_handover_items';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const requiredColumns = ['evidence_url'] as const;
    const missing: string[] = [];
    for (const columnName of requiredColumns) {
        const ok = await columnExists(tableName, columnName);
        if (!ok) missing.push(columnName);
    }

    if (missing.length === 0) return;

    console.warn(`[Startup] Missing columns in ${tableName}: ${missing.join(', ')}. Applying targeted ALTER TABLE...`);

    const addColumn = async (columnName: string, sqlType: string) => {
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${sqlType}`
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code === 'ER_DUP_FIELDNAME') return;
            throw error;
        }
    };

    if (missing.includes('evidence_url')) {
        await addColumn('evidence_url', 'VARCHAR(255) NULL AFTER `note`');
    }
};

const ensureInvoiceAmountReceivedColumnReady = async () => {
    const tableName = 'invoices';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const columnName = 'amount_received';
    const ok = await columnExists(tableName, columnName);
    if (ok) return;

    console.warn(`[Startup] Missing column in ${tableName}: ${columnName}. Applying targeted ALTER TABLE...`);
    try {
        await sequelize.query(
            `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` DECIMAL(15, 2) NULL AFTER \`amount_paid\``
        );
    } catch (error: any) {
        const code = error?.parent?.code || error?.original?.code || error?.code;
        if (code === 'ER_DUP_FIELDNAME') return;
        throw error;
    }
};

const ensureClearancePromoQtyLimitColumnReady = async () => {
    const tableName = 'clearance_promos';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const columnName = 'qty_limit';
    const ok = await columnExists(tableName, columnName);
    if (ok) return;

    console.warn(`[Startup] Missing column in ${tableName}: ${columnName}. Applying targeted ALTER TABLE...`);
    try {
        await sequelize.query(
            `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` INT NULL AFTER \`target_unit_cost\``
        );
    } catch (error: any) {
        const code = error?.parent?.code || error?.original?.code || error?.code;
        if (code === 'ER_DUP_FIELDNAME') return;
        throw error;
    }
};

const ensureProductsBarcodeColumnReady = async () => {
    const tableName = 'products';
    const exists = await tableExists(tableName);
    if (!exists) return;

    const columnName = 'barcode';
    const ok = await columnExists(tableName, columnName);
    if (!ok) {
        console.warn(`[Startup] Missing column in ${tableName}: ${columnName}. Applying targeted ALTER TABLE...`);
        try {
            await sequelize.query(
                `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` VARCHAR(255) NULL AFTER \`sku\``
            );
        } catch (error: any) {
            const code = error?.parent?.code || error?.original?.code || error?.code;
            if (code !== 'ER_DUP_FIELDNAME') throw error;
        }
    }

    const hasIndex = await indexOnColumnExists(tableName, columnName);
    if (hasIndex) return;

    console.warn(`[Startup] Missing index in ${tableName}: ${columnName}. Creating index...`);
    try {
        await sequelize.query(`CREATE INDEX \`idx_products_barcode\` ON \`${tableName}\` (\`${columnName}\`)`);
    } catch (error: any) {
        const code = error?.parent?.code || error?.original?.code || error?.code;
        if (code === 'ER_DUP_KEYNAME') return;
        throw error;
    }
};

const syncDatabaseWithRetry = async () => {
    const syncMode = resolveDbSyncMode();
    if (syncMode === 'off') {
        console.log('[Startup] DB sync skipped (DB_SYNC_MODE=off)');
        return;
    }

    if (syncMode === 'safe') {
        await sequelize.sync();
        await ensureCriticalTablesReady();
        await ensureInboundCostVarianceColumnsReady();
        await ensureReturHandoverDebtSnapshotColumnsReady();
        await ensureCodSettlementAuditColumnsReady();
        await ensureDeliveryHandoverItemEvidenceColumnsReady();
        await ensureInvoiceAmountReceivedColumnReady();
        await ensureClearancePromoQtyLimitColumnReady();
        await ensureProductsBarcodeColumnReady();
        await ensureReportIndexesReady();
        return;
    }

    const maxAttempts = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await sequelize.sync({ alter: true });
            await ensureCriticalTablesReady();
            await ensureInboundCostVarianceColumnsReady();
            await ensureReturHandoverDebtSnapshotColumnsReady();
            await ensureCodSettlementAuditColumnsReady();
            await ensureDeliveryHandoverItemEvidenceColumnsReady();
            await ensureInvoiceAmountReceivedColumnReady();
            await ensureClearancePromoQtyLimitColumnReady();
            await ensureProductsBarcodeColumnReady();
            await ensureReportIndexesReady();
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
            await ensureInboundCostVarianceColumnsReady();
            await ensureReturHandoverDebtSnapshotColumnsReady();
            await ensureCodSettlementAuditColumnsReady();
            await ensureDeliveryHandoverItemEvidenceColumnsReady();
            await ensureInvoiceAmountReceivedColumnReady();
            await ensureClearancePromoQtyLimitColumnReady();
            await ensureProductsBarcodeColumnReady();
            await ensureReportIndexesReady();
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

        const currentValues = parseEnumValuesFromColumnType(statusColumn.columnType);
        const missingRequired = ORDER_STATUS_ENUM_VALUES.filter((value) => !currentValues.includes(value));
        if (missingRequired.length === 0) return;

        // Keep any legacy values already in DB to avoid ALTER failure from existing rows.
        const mergedValues = Array.from(new Set([...currentValues, ...ORDER_STATUS_ENUM_VALUES]));
        const enumValuesSql = mergedValues.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE orders
             MODIFY COLUMN status ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'pending'`
        );
        console.log(`Order status enum updated: added [${missingRequired.join(', ')}]`);
    } catch (error) {
        console.error('Failed to ensure orders.status enum values:', error);
        throw error;
    }
};

const ensureOrderEventTypeEnumReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'order_events'
               AND COLUMN_NAME = 'event_type'`
        ) as any;

        const col = rows?.[0];
        if (!col) {
            console.warn('Skip order_events.event_type enum update: column not found yet');
            return;
        }

        const currentValues = parseEnumValuesFromColumnType(col.columnType);
        const missingRequired = ORDER_EVENT_TYPE_ENUM_VALUES.filter((value) => !currentValues.includes(value));
        if (missingRequired.length === 0) return;

        const mergedValues = Array.from(new Set([...currentValues, ...ORDER_EVENT_TYPE_ENUM_VALUES]));
        const enumValuesSql = mergedValues.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE order_events
             MODIFY COLUMN event_type ENUM(${enumValuesSql})
             NOT NULL`
        );
        console.log(`Order events enum updated: added [${missingRequired.join(', ')}]`);
    } catch (error) {
        console.error('Failed to ensure order_events.event_type enum values:', error);
        throw error;
    }
};

const ensureOrderItemManualCancelColumnReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COUNT(*) AS cnt
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'order_items'
               AND COLUMN_NAME = 'qty_canceled_manual'`
        ) as any;
        const count = Number(rows?.[0]?.cnt || 0);
        if (count > 0) return;

        await sequelize.query(
            `ALTER TABLE order_items
             ADD COLUMN qty_canceled_manual INT NOT NULL DEFAULT 0 AFTER qty_canceled_backorder`
        );
        console.log('Order items schema updated: added qty_canceled_manual');
    } catch (error) {
        console.error('Failed to ensure order_items.qty_canceled_manual column:', error);
        throw error;
    }
};

const ensureInvoiceShipmentStatusEnumReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'invoices'
               AND COLUMN_NAME = 'shipment_status'`
        ) as any;

        const col = rows?.[0];
        if (!col) {
            console.warn('Skip invoices.shipment_status enum update: column not found yet');
            return;
        }

        const currentValues = parseEnumValuesFromColumnType(col.columnType);
        const missingRequired = INVOICE_SHIPMENT_STATUS_ENUM_VALUES.filter((value) => !currentValues.includes(value));
        if (missingRequired.length === 0) return;

        const mergedValues = Array.from(new Set([...currentValues, ...INVOICE_SHIPMENT_STATUS_ENUM_VALUES]));
        const enumValuesSql = mergedValues.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE invoices
             MODIFY COLUMN shipment_status ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'ready_to_ship'`
        );
        console.log(`Invoice shipment status enum updated: added [${missingRequired.join(', ')}]`);
    } catch (error) {
        console.error('Failed to ensure invoices.shipment_status enum values:', error);
        throw error;
    }
};

const ensureUserRoleEnumReady = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    try {
        const [rows] = await sequelize.query(
            `SELECT COLUMN_TYPE AS columnType
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'role'`
        ) as any;

        const col = rows?.[0];
        if (!col) {
            console.warn('Skip users.role enum update: column not found yet');
            return;
        }

        const currentValues = parseEnumValuesFromColumnType(col.columnType);
        const missingRequired = USER_ROLE_ENUM_VALUES.filter((value) => !currentValues.includes(value));
        if (missingRequired.length === 0) return;

        const mergedValues = Array.from(new Set([...currentValues, ...USER_ROLE_ENUM_VALUES]));
        const enumValuesSql = mergedValues.map((value) => `'${value.replace(/'/g, "\\'")}'`).join(', ');
        await sequelize.query(
            `ALTER TABLE users
             MODIFY COLUMN role ENUM(${enumValuesSql})
             NOT NULL DEFAULT 'customer'`
        );
        console.log(`User role enum updated: added [${missingRequired.join(', ')}]`);
    } catch (error) {
        console.error('Failed to ensure users.role enum values:', error);
        throw error;
    }
};

const normalizeWaitingPaymentOrders = async () => {
	        try {
        const [updated] = await Order.update(
            { status: 'ready_to_ship', expiry_date: null },
            { where: { status: 'waiting_payment' } }
        );
        if (updated > 0) {
            console.log(`Normalized ${updated} orders from waiting_payment to ready_to_ship.`);
        }
    } catch (error) {
        console.error('Failed to normalize waiting_payment orders:', error);
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
		            await runStartupStep('Normalize waiting_payment orders', normalizeWaitingPaymentOrders);
		            await runStartupStep('Ensure orders pricing override columns', ensureOrderPricingOverrideColumnsReady);
		            await runStartupStep('Ensure users.role enum', ensureUserRoleEnumReady);
		            await runStartupStep('Ensure orders.status enum', ensureOrderStatusEnumReady);
			            await runStartupStep('Ensure invoices.shipment_status enum', ensureInvoiceShipmentStatusEnumReady);
			            await runStartupStep('Ensure returs.status enum', ensureReturStatusEnumReady);
			            await runStartupStep('Ensure order_events.event_type enum', ensureOrderEventTypeEnumReady);
			            await runStartupStep('Ensure order_items manual cancel column', ensureOrderItemManualCancelColumnReady);
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

        startNotificationOutboxWorker();

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
