import { Request, Response } from 'express';
import { Op, Transaction } from 'sequelize';
import { User, CustomerProfile, Order, Invoice, OrderAllocation, Product, sequelize } from '../models';
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import waClient, { getStatus as getWhatsappStatus } from '../services/whatsappClient';
import { getWhatsappLookupCandidates, normalizeWhatsappNumber } from '../utils/whatsappNumber';

const OPEN_ORDER_STATUSES = [
    'pending',
    'waiting_invoice',
    'waiting_payment',
    'ready_to_ship',
    'allocated',
    'partially_fulfilled',
    'debt_pending',
    'hold',
] as const;
const ALLOWED_TIERS = ['regular', 'gold', 'platinum'] as const;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const MIN_CUSTOMER_PASSWORD_LENGTH = 6;

type CustomerOtpSession = {
    code: string;
    expiresAt: number;
    resendAvailableAt: number;
    requestedBy: string;
    attempts: number;
};

const customerOtpMap = new Map<string, CustomerOtpSession>();

const normalizeId = (value: unknown): string => {
    if (Array.isArray(value)) {
        return String(value[0] || '').trim();
    }
    return String(value || '').trim();
};

const parsePositiveNumber = (value: unknown, fallback: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
};

const normalizeTier = (value: unknown): (typeof ALLOWED_TIERS)[number] => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (ALLOWED_TIERS.includes(raw as (typeof ALLOWED_TIERS)[number])) {
        return raw as (typeof ALLOWED_TIERS)[number];
    }
    return 'regular';
};

const normalizeEmail = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email || null;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const cleanupOtpSessions = () => {
    const now = Date.now();
    for (const [key, value] of customerOtpMap.entries()) {
        if (value.expiresAt <= now) {
            customerOtpMap.delete(key);
        }
    }
};

export const sendCustomerOtp = async (req: Request, res: Response) => {
    try {
        cleanupOtpSessions();

        const normalizedWhatsapp = normalizeWhatsappNumber(req.body?.whatsapp_number);
        if (!normalizedWhatsapp) {
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid' });
        }

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const existing = await User.findOne({
            where: { whatsapp_number: { [Op.in]: getWhatsappLookupCandidates(normalizedWhatsapp) } },
            attributes: ['id', 'role']
        });
        if (existing) {
            return res.status(409).json({ message: 'Nomor WhatsApp sudah terdaftar di sistem' });
        }

        const waStatus = getWhatsappStatus();
        if (waStatus !== 'READY') {
            return res.status(409).json({ message: 'WhatsApp bot belum terhubung. Silakan connect WhatsApp terlebih dahulu.' });
        }

        const now = Date.now();
        const previous = customerOtpMap.get(normalizedWhatsapp);
        if (previous && previous.expiresAt > now && previous.resendAvailableAt > now) {
            return res.status(429).json({
                message: 'OTP baru saja dikirim. Coba lagi sebentar.',
                retry_after_sec: Math.ceil((previous.resendAvailableAt - now) / 1000)
            });
        }

        const otpCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const waMessage =
            `Kode verifikasi Migunani Motor: ${otpCode}\n` +
            `Kode ini berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`;

        await waClient.sendMessage(`${normalizedWhatsapp}@c.us`, waMessage);

        customerOtpMap.set(normalizedWhatsapp, {
            code: otpCode,
            expiresAt: now + OTP_TTL_MS,
            resendAvailableAt: now + OTP_RESEND_COOLDOWN_MS,
            requestedBy: actorId,
            attempts: 0,
        });

        res.json({
            message: 'Kode OTP berhasil dikirim ke WhatsApp customer',
            expires_in_sec: Math.ceil(OTP_TTL_MS / 1000),
            resend_in_sec: Math.ceil(OTP_RESEND_COOLDOWN_MS / 1000),
        });
    } catch (error: any) {
        res.status(500).json({
            message: error?.message || 'Gagal mengirim OTP WhatsApp'
        });
    }
};

export const createCustomerByAdmin = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        cleanupOtpSessions();

        const actorId = String(req.user?.id || '').trim();
        if (!actorId) {
            await t.rollback();
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const normalizedWhatsapp = normalizeWhatsappNumber(req.body?.whatsapp_number);
        const otpCode = typeof req.body?.otp_code === 'string' ? req.body.otp_code.trim() : '';
        const email = normalizeEmail(req.body?.email);
        const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
        const tier = normalizeTier(req.body?.tier);

        if (!name) {
            await t.rollback();
            return res.status(400).json({ message: 'Nama customer wajib diisi' });
        }
        if (!normalizedWhatsapp) {
            await t.rollback();
            return res.status(400).json({ message: 'Nomor WhatsApp tidak valid' });
        }
        if (!/^\d{6}$/.test(otpCode)) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode OTP harus 6 digit' });
        }
        if (!email) {
            await t.rollback();
            return res.status(400).json({ message: 'Email wajib diisi' });
        }
        if (!isValidEmail(email)) {
            await t.rollback();
            return res.status(400).json({ message: 'Format email tidak valid' });
        }
        if (!password || password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
            await t.rollback();
            return res.status(400).json({ message: `Password minimal ${MIN_CUSTOMER_PASSWORD_LENGTH} karakter` });
        }

        const otpSession = customerOtpMap.get(normalizedWhatsapp);
        const now = Date.now();
        if (!otpSession || otpSession.expiresAt <= now) {
            customerOtpMap.delete(normalizedWhatsapp);
            await t.rollback();
            return res.status(400).json({ message: 'OTP tidak ditemukan atau sudah kedaluwarsa. Silakan kirim ulang OTP.' });
        }
        if (otpSession.requestedBy !== actorId) {
            await t.rollback();
            return res.status(403).json({ message: 'OTP ini diminta oleh akun admin lain. Silakan kirim OTP baru.' });
        }
        if (otpSession.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
            customerOtpMap.delete(normalizedWhatsapp);
            await t.rollback();
            return res.status(400).json({ message: 'Percobaan OTP melebihi batas. Silakan kirim OTP baru.' });
        }
        if (otpSession.code !== otpCode) {
            otpSession.attempts += 1;
            customerOtpMap.set(normalizedWhatsapp, otpSession);
            await t.rollback();
            return res.status(400).json({ message: 'Kode OTP salah' });
        }

        const whatsappCandidates = getWhatsappLookupCandidates(normalizedWhatsapp);
        const conflictConditions: Array<Record<string, unknown>> = [
            { whatsapp_number: { [Op.in]: whatsappCandidates } }
        ];
        if (email) {
            conflictConditions.push({ email });
        }

        const existing = await User.findOne({
            where: { [Op.or]: conflictConditions },
            transaction: t
        });
        if (existing) {
            await t.rollback();
            return res.status(409).json({ message: 'Email atau nomor WhatsApp sudah terdaftar' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            whatsapp_number: normalizedWhatsapp,
            role: 'customer',
            status: 'active',
            debt: 0
        }, { transaction: t });

        await CustomerProfile.create({
            user_id: user.id,
            tier,
            credit_limit: 0,
            points: 0,
            saved_addresses: []
        }, { transaction: t });

        await t.commit();
        customerOtpMap.delete(normalizedWhatsapp);

        res.status(201).json({
            message: 'Customer berhasil ditambahkan',
            customer: {
                id: user.id,
                name: user.name,
                email: user.email,
                whatsapp_number: user.whatsapp_number,
                status: user.status,
                role: user.role,
                CustomerProfile: {
                    tier,
                    credit_limit: 0,
                    points: 0,
                }
            }
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Gagal menambahkan customer', error });
    }
};

export const updateCustomerTier = async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const requestedTier = typeof req.body?.tier === 'string' ? req.body.tier.trim().toLowerCase() : '';
        if (!ALLOWED_TIERS.includes(requestedTier as (typeof ALLOWED_TIERS)[number])) {
            return res.status(400).json({ message: 'Tier tidak valid. Gunakan regular/gold/platinum' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status']
        });
        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const [profile] = await CustomerProfile.findOrCreate({
            where: { user_id: customer.id },
            defaults: {
                user_id: customer.id,
                tier: requestedTier as (typeof ALLOWED_TIERS)[number],
                credit_limit: 0,
                points: 0,
                saved_addresses: []
            }
        });

        if (profile.tier !== requestedTier) {
            await profile.update({ tier: requestedTier as (typeof ALLOWED_TIERS)[number] });
        }

        res.json({
            message: 'Tier customer berhasil diperbarui',
            customer: {
                id: customer.id,
                name: customer.name,
                whatsapp_number: customer.whatsapp_number,
                status: customer.status,
                CustomerProfile: {
                    tier: requestedTier,
                    credit_limit: profile.credit_limit,
                    points: profile.points
                }
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Gagal update tier customer', error });
    }
};

const applyCustomerSearch = (whereClause: any, search: unknown) => {
    const keyword = typeof search === 'string' ? search.trim() : '';
    if (!keyword) return;

    whereClause[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { whatsapp_number: { [Op.like]: `%${keyword}%` } },
        { email: { [Op.like]: `%${keyword}%` } }
    ];
};

const applyStatusFilter = (whereClause: any, status: unknown) => {
    const statusParam = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!statusParam || statusParam === 'all') return;
    if (!['active', 'banned'].includes(statusParam)) return;
    whereClause.status = statusParam;
};

const releaseOrderAllocationStock = async (orderId: string, t: Transaction) => {
    const allocations = await OrderAllocation.findAll({
        where: { order_id: orderId },
        transaction: t,
        lock: t.LOCK.UPDATE
    });

    for (const alloc of allocations) {
        if (!alloc.allocated_qty || alloc.allocated_qty <= 0) continue;

        const product = await Product.findByPk(alloc.product_id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) continue;

        await product.update({
            stock_quantity: Number(product.stock_quantity || 0) + Number(alloc.allocated_qty || 0),
            allocated_quantity: Math.max(0, Number(product.allocated_quantity || 0) - Number(alloc.allocated_qty || 0)),
        }, { transaction: t });
    }
};

export const searchCustomers = async (req: Request, res: Response) => {
    try {
        const { search, status = 'active', limit = 20 } = req.query;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            limit: parsePositiveNumber(limit, 20, 100),
            order: [['createdAt', 'DESC']]
        });

        res.json({ customers });
    } catch (error) {
        res.status(500).json({ message: 'Error searching customers', error });
    }
};

export const getCustomers = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 20, search, status = 'all' } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;

        const whereClause: any = {
            role: 'customer',
        };
        applyStatusFilter(whereClause, status);
        applyCustomerSearch(whereClause, search);

        const customers = await User.findAndCountAll({
            where: whereClause,
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points'] }
            ],
            distinct: true,
            limit: safeLimit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const customerIds = customers.rows.map((item) => item.id);
        const openOrderRows = customerIds.length
            ? await Order.findAll({
                attributes: [
                    'customer_id',
                    [sequelize.fn('COUNT', sequelize.col('id')), 'count']
                ],
                where: {
                    customer_id: { [Op.in]: customerIds },
                    status: { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] }
                },
                group: ['customer_id'],
                raw: true
            }) as unknown as Array<{ customer_id: string; count: number }>
            : [];

        const openOrderCountByCustomer = new Map<string, number>();
        for (const row of openOrderRows) {
            openOrderCountByCustomer.set(String(row.customer_id), Number(row.count || 0));
        }

        const rows = customers.rows.map((item) => {
            const plain = item.get({ plain: true }) as any;
            return {
                ...plain,
                open_order_count: openOrderCountByCustomer.get(item.id) || 0,
            };
        });

        res.json({
            total: customers.count,
            totalPages: Math.ceil(customers.count / safeLimit),
            currentPage: safePage,
            customers: rows,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customers', error });
    }
};

export const getCustomerById = async (req: Request, res: Response) => {
    try {
        const id = normalizeId(req.params?.id);
        if (!id) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            attributes: ['id', 'name', 'whatsapp_number', 'email', 'status', 'debt', 'createdAt', 'updatedAt'],
            include: [
                { model: CustomerProfile, attributes: ['tier', 'credit_limit', 'points', 'saved_addresses'] }
            ]
        });

        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const orderCountRows = await Order.findAll({
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            where: { customer_id: id },
            group: ['status'],
            raw: true,
        }) as unknown as Array<{ status: string; count: number }>;

        const statusCounts: Record<string, number> = {};
        let totalOrders = 0;
        let openOrders = 0;
        for (const row of orderCountRows) {
            const count = Number(row.count || 0);
            statusCounts[row.status] = count;
            totalOrders += count;
            if (OPEN_ORDER_STATUSES.includes(row.status as (typeof OPEN_ORDER_STATUSES)[number])) {
                openOrders += count;
            }
        }

        res.json({
            customer,
            summary: {
                total_orders: totalOrders,
                open_orders: openOrders,
                status_counts: statusCounts,
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customer detail', error });
    }
};

export const getCustomerOrders = async (req: Request, res: Response) => {
    try {
        const customerId = normalizeId(req.params?.id);
        if (!customerId) {
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        const customer = await User.findOne({
            where: { id: customerId, role: 'customer' },
            attributes: ['id']
        });
        if (!customer) {
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const { page = 1, limit = 20, scope = 'all', status } = req.query;
        const safePage = parsePositiveNumber(page, 1, 100000);
        const safeLimit = parsePositiveNumber(limit, 20, 100);
        const offset = (safePage - 1) * safeLimit;

        const whereClause: any = {
            customer_id: customerId,
        };

        const scopeParam = typeof scope === 'string' ? scope.trim().toLowerCase() : 'all';
        const statusParam = typeof status === 'string' ? status.trim() : '';

        if (scopeParam === 'open') {
            whereClause.status = { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] };
        } else if (statusParam && statusParam !== 'all') {
            whereClause.status = statusParam;
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Invoice,
                    attributes: ['invoice_number', 'payment_method', 'payment_status']
                }
            ],
            distinct: true,
            limit: safeLimit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / safeLimit),
            currentPage: safePage,
            orders: orders.rows,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching customer orders', error });
    }
};

export const updateCustomerStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = normalizeId(req.params?.id);
        const nextStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
        const haltOpenOrders = req.body?.halt_open_orders !== false;

        if (!id) {
            await t.rollback();
            return res.status(400).json({ message: 'ID customer tidak valid' });
        }

        if (!['active', 'banned'].includes(nextStatus)) {
            await t.rollback();
            return res.status(400).json({ message: 'Status customer harus active atau banned' });
        }

        const customer = await User.findOne({
            where: { id, role: 'customer' },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!customer) {
            await t.rollback();
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }

        const haltedOrderIds: string[] = [];

        if (nextStatus === 'banned' && haltOpenOrders) {
            const openOrders = await Order.findAll({
                where: {
                    customer_id: customer.id,
                    status: { [Op.in]: OPEN_ORDER_STATUSES as unknown as string[] }
                },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            for (const order of openOrders) {
                if (order.status === 'canceled') continue;

                if (order.stock_released === false) {
                    await releaseOrderAllocationStock(order.id, t);
                }

                await order.update({
                    status: 'canceled',
                    stock_released: true,
                }, { transaction: t });

                haltedOrderIds.push(order.id);
            }
        }

        await customer.update({ status: nextStatus as 'active' | 'banned' }, { transaction: t });

        await t.commit();

        const message = nextStatus === 'banned'
            ? 'Customer berhasil diblokir'
            : 'Customer berhasil diaktifkan kembali';

        res.json({
            message,
            customer: {
                id: customer.id,
                name: customer.name,
                status: nextStatus,
            },
            halted_order_count: haltedOrderIds.length,
            halted_order_ids: haltedOrderIds,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating customer status', error });
    }
};
