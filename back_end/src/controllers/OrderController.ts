import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur } from '../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from './ShippingMethodController';

// --- Customer Endpoints ---
const DELIVERY_EMPLOYEE_ROLES = ['driver'] as const;
const ORDER_STATUS_OPTIONS = ['pending', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'hold'] as const;
const ISSUE_SLA_HOURS = 48;

const GENERIC_CUSTOMER_NAMES = new Set([
    'customer',
    'super_admin',
    'admin_gudang',
    'admin_finance',
    'driver'
]);

const isGenericCustomerName = (value: unknown): boolean => {
    if (typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    return GENERIC_CUSTOMER_NAMES.has(normalized);
};

const resolveCustomerName = (orderLike: any): string => {
    const rawName = typeof orderLike?.customer_name === 'string' ? orderLike.customer_name.trim() : '';
    if (!isGenericCustomerName(rawName)) return rawName;

    const relatedName = typeof orderLike?.Customer?.name === 'string'
        ? orderLike.Customer.name.trim()
        : '';
    if (relatedName) return relatedName;

    return rawName || 'Customer';
};

const resolveEmployeeDisplayName = (userLike: any): string => {
    const rawName = typeof userLike?.name === 'string' ? userLike.name.trim() : '';
    if (!isGenericCustomerName(rawName)) return rawName;

    const email = typeof userLike?.email === 'string' ? userLike.email.trim() : '';
    if (email) return email;

    const wa = typeof userLike?.whatsapp_number === 'string' ? userLike.whatsapp_number.trim() : '';
    if (wa) return wa;

    const role = typeof userLike?.role === 'string' ? userLike.role.trim() : '';
    if (role) return role;

    return 'Karyawan';
};

const getActiveIssue = (orderLike: any) => {
    const issues = Array.isArray(orderLike?.Issues) ? orderLike.Issues : [];
    return issues.find((issue: any) => issue?.status === 'open') || null;
};

const withOrderTrackingFields = (orderLike: any) => {
    const activeIssue = getActiveIssue(orderLike);
    const dueAt = activeIssue?.due_at ? new Date(activeIssue.due_at) : null;
    const isOverdue = !!(dueAt && dueAt.getTime() < Date.now());

    return {
        ...orderLike,
        customer_name: resolveCustomerName(orderLike),
        courier_display_name: orderLike?.Courier ? resolveEmployeeDisplayName(orderLike.Courier) : null,
        active_issue: activeIssue
            ? {
                id: activeIssue.id,
                issue_type: activeIssue.issue_type,
                status: activeIssue.status,
                note: activeIssue.note,
                due_at: activeIssue.due_at,
                resolved_at: activeIssue.resolved_at,
            }
            : null,
        issue_overdue: isOverdue,
    };
};

const normalizeIssueNote = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
            return {};
        } catch {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
};

const resolveTierPriceFromVariant = (basePrice: number, tier: string, variantRaw: unknown): number => {
    if (tier === 'regular') return basePrice;

    const source = toObjectOrEmpty(variantRaw);
    const prices = toObjectOrEmpty(source.prices);
    const discounts = toObjectOrEmpty(source.discounts_pct);
    const aliases = tier === 'platinum' ? ['premium'] : [];

    const directCandidates: unknown[] = [
        source[tier],
        prices[tier],
        toObjectOrEmpty(source[tier]).price
    ];

    for (const alias of aliases) {
        directCandidates.push(source[alias], prices[alias], toObjectOrEmpty(source[alias]).price);
    }

    for (const candidate of directCandidates) {
        const direct = toFiniteNumber(candidate);
        if (direct !== null) return Math.max(0, direct);
    }

    const discountCandidates: unknown[] = [
        discounts[tier],
        toObjectOrEmpty(source[tier]).discount_pct,
        source[`${tier}_discount_pct`]
    ];
    for (const alias of aliases) {
        discountCandidates.push(discounts[alias], toObjectOrEmpty(source[alias]).discount_pct, source[`${alias}_discount_pct`]);
    }

    for (const discountRaw of discountCandidates) {
        const discountPct = toFiniteNumber(discountRaw);
        if (discountPct === null) continue;
        if (discountPct < 0 || discountPct > 100) continue;
        return Math.max(0, Math.round((basePrice * (1 - discountPct / 100)) * 100) / 100);
    }

    return basePrice;
};

export const checkout = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id; // Authenticated user
        const userRole = req.user!.role;
        const { items, payment_method, from_cart, customer_id, source, shipping_method_code } = req.body;
        // items: [{ product_id, qty }]
        // payment_method: 'transfer_manual' | 'cod'
        // from_cart: boolean
        // source: 'web' | 'whatsapp'

        let targetCustomerId = userId;
        if (['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole) && customer_id) {
            targetCustomerId = customer_id;
        }

        let finalItems = items;

        if (from_cart) {
            // Cart Logic assumes targetCustomerId is the one with the cart? 
            // Usually admins won't use 'from_cart' for others unless we pass cart_id.
            // Let's assume admins only use 'items' array.
            const cart = await Cart.findOne({
                where: { user_id: targetCustomerId },
                include: [CartItem]
            });

            if (!cart || !cart.CartItems || cart.CartItems.length === 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Cart is empty' });
            }

            // Map CartItems to standard items format
            finalItems = cart.CartItems.map((ci: any) => ({
                product_id: ci.product_id,
                qty: ci.qty
            }));
        } else if (!items || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Cart is empty' });
        }

        let totalAmount = 0;
        const orderItemsData = [];

        const customer = await User.findByPk(targetCustomerId, {
            attributes: ['id', 'name', 'role', 'status'],
            include: [{ model: CustomerProfile, attributes: ['tier', 'points'] }],
            transaction: t
        });
        if (!customer) {
            await t.rollback();
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }
        if (customer.role !== 'customer') {
            await t.rollback();
            return res.status(400).json({ message: 'Order hanya bisa dibuat untuk akun customer' });
        }
        if (customer.status !== 'active') {
            await t.rollback();
            return res.status(403).json({ message: 'Akun customer sedang diblokir' });
        }
        const customerName = typeof customer?.name === 'string' && customer.name.trim()
            ? customer.name.trim()
            : 'Customer';

        const customerProfile = (customer as any)?.CustomerProfile as (CustomerProfile & { tier?: string; points?: number }) | undefined;
        const userTier = customerProfile?.tier || 'regular';

        // Validate products & Calculate Total
        // NOTE: Stock is NOT decremented here. Stock allocation happens when admin reviews.
        for (const item of finalItems) {
            const product = await Product.findByPk(item.product_id, {
                transaction: t,
            });

            if (!product) {
                await t.rollback();
                return res.status(404).json({ message: `Product ${item.product_id} not found` });
            }

            // Stock check is informational only — admin will do final allocation
            // We still create the order even if stock is low (admin decides)

            // Calculate Price (Snapshot)
            let priceAtPurchase = Number(product.price);

            // Tier Pricing Logic (harga langsung atau fallback diskon %)
            priceAtPurchase = resolveTierPriceFromVariant(Number(product.price), String(userTier || 'regular'), product.varian_harga);

            const costAtPurchase = Number(product.base_price);
            const subtotal = priceAtPurchase * item.qty;

            totalAmount += subtotal;

            orderItemsData.push({
                product_id: product.id,
                qty: item.qty,
                price_at_purchase: priceAtPurchase,
                cost_at_purchase: costAtPurchase
            });
        }

        const selectedShippingMethod = await resolveShippingMethodByCode(shipping_method_code);
        if (shipping_method_code && !selectedShippingMethod) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pengiriman tidak valid atau tidak aktif' });
        }
        const shippingFee = Number(selectedShippingMethod?.fee || 0);
        totalAmount += shippingFee;
        const pointsEarned = Math.floor(Math.max(0, Number(totalAmount || 0)) / 1000);
        let customerPointsBalance = Number(customerProfile?.points || 0);

        // Create Order
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30); // 30 Days expiry

        const order = await Order.create({
            customer_id: targetCustomerId,
            customer_name: customerName,
            source: (source === 'whatsapp') ? 'whatsapp' : 'web',
            status: 'pending', // All orders start as pending — admin reviews and allocates
            total_amount: totalAmount,
            discount_amount: 0,
            expiry_date: expiryDate,
            stock_released: false
        }, { transaction: t });

        // Create Order Items
        for (const itemData of orderItemsData) {
            await OrderItem.create({
                order_id: order.id,
                ...itemData
            }, { transaction: t });
        }

        // Create Invoice
        const invoiceNumber = `INV/${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}/${Date.now().toString().slice(-4)}`;

        await Invoice.create({
            order_id: order.id,
            invoice_number: invoiceNumber,
            payment_method: payment_method || 'transfer_manual',
            payment_status: 'draft',
            amount_paid: 0,
            change_amount: 0
        }, { transaction: t });

        if (pointsEarned > 0) {
            if (customerProfile) {
                customerPointsBalance += pointsEarned;
                await customerProfile.update({ points: customerPointsBalance }, { transaction: t });
            } else {
                await CustomerProfile.create({
                    user_id: targetCustomerId,
                    tier: 'regular',
                    credit_limit: 0,
                    points: pointsEarned,
                    saved_addresses: []
                }, { transaction: t });
                customerPointsBalance = pointsEarned;
            }
        }

        await t.commit();

        // If successful and from_cart, clear the cart
        if (from_cart) {
            const cart = await Cart.findOne({ where: { user_id: targetCustomerId } });
            if (cart) {
                await CartItem.destroy({ where: { cart_id: cart.id } });
            }
        }

        res.status(201).json({
            message: 'Order placed successfully',
            order_id: order.id,
            invoice_number: invoiceNumber,
            total_amount: totalAmount,
            points_earned: pointsEarned,
            customer_points_balance: customerPointsBalance,
            shipping_method_code: selectedShippingMethod?.code || null,
            shipping_method_name: selectedShippingMethod?.name || null,
            shipping_fee: shippingFee,
            status: order.status
        });

    } catch (error) {
        // t.rollback() is handled by each return or here if error matches
        // Actually, if we return inside try, we explicitly rollback. 
        // If error thrown, we rollback here.
        // We need to check if transaction is finished?
        // simple way:
        try { await t.rollback(); } catch (e) { }
        res.status(500).json({ message: 'Checkout failed', error });
    }
};

export const getMyOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const { page = 1, limit = 10, status } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = { customer_id: userId };
        if (status) whereClause.status = status;

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                { model: Invoice, attributes: ['invoice_number', 'payment_status', 'payment_method'] },
                { model: Retur, attributes: ['id', 'status'] }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: orders.rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getOrderDetails = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const userRole = req.user!.role;

        const whereClause: any = { id };

        // Customers can only see their own orders
        if (userRole === 'customer') {
            whereClause.customer_id = userId;
        }

        const order = await Order.findOne({
            where: whereClause,
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number', 'email'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'role', 'whatsapp_number'] },
                { model: OrderIssue, as: 'Issues', where: { status: 'open' }, required: false },
                { model: OrderItem, include: [{ model: Product, attributes: ['name', 'sku', 'unit'] }] },
                { model: Invoice },
                { model: OrderAllocation, as: 'Allocations' },
                { model: Retur }
            ]
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const plainOrder = order.get({ plain: true }) as any;
        res.json(withOrderTrackingFields(plainOrder));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order details', error });
    }
};

export const uploadPaymentProof = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const userId = req.user!.id;
        const file = req.file;

        if (!file) {
            await t.rollback();
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const order = await Order.findOne({
            where: { id, customer_id: userId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        // Update Invoice
        const invoice = await Invoice.findOne({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status === 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Pesanan sudah dibayar.' });
        }

        if (invoice.payment_proof_url) {
            await t.rollback();
            return res.status(400).json({ message: 'Bukti transfer sudah diunggah dan sedang dalam verifikasi.' });
        }

        // In real app, upload to S3/Cloudinary and get URL. 
        // Here we store the local path or filename.
        await invoice.update({
            payment_proof_url: file.path,
            // Keep unpaid until admin_finance verifies transfer.
            payment_status: 'unpaid',
            verified_by: null,
            verified_at: null,
        }, { transaction: t });

        // Update Order Status
        await order.update({ status: 'waiting_payment' }, { transaction: t }); // "Menunggu Verifikasi" usually maps here or Processing? 
        // Schema has: 'pending', 'waiting_payment', 'processing'.
        // Let's assume 'waiting_payment' = Waiting for Transfer. 
        // Once uploaded, maybe 'processing' or stay 'waiting_payment' but Invoice is marked?
        // Let's stick to Schema: 'waiting_payment' is usually BEFORE upload.
        // After upload, maybe it becomes 'processing' (verification needed)? or we need a new status 'verifying'?
        // The Prompt US-C04 says "Menunggu Verifikasi".
        // Let's update order status to 'processing' to indicate it moved forward, or keep it simple.

        await t.commit();
        res.json({ message: 'Payment proof uploaded' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error uploading proof', error });
    }
};

// --- Admin Endpoints ---

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, search, startDate, endDate, dateFrom, dateTo } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        if (status && status !== 'all') {
            const statusStr = String(status);
            if (statusStr.includes(',')) {
                whereClause.status = { [Op.in]: statusStr.split(',').map(s => s.trim()) };
            } else {
                whereClause.status = statusStr;
            }
        }

        const searchText = typeof search === 'string' ? search.trim() : '';
        if (searchText) {
            whereClause[Op.or] = [
                { id: { [Op.like]: `%${searchText}%` } },
                { customer_name: { [Op.like]: `%${searchText}%` } },
                { customer_id: { [Op.like]: `%${searchText}%` } },
                { '$Invoice.invoice_number$': { [Op.like]: `%${searchText}%` } },
                { '$Customer.name$': { [Op.like]: `%${searchText}%` } },
            ];
        }

        const startRaw = typeof startDate === 'string' ? startDate : (typeof dateFrom === 'string' ? dateFrom : '');
        const endRaw = typeof endDate === 'string' ? endDate : (typeof dateTo === 'string' ? dateTo : '');

        const createdAtRange: any = {};

        if (startRaw) {
            const start = new Date(startRaw);
            if (!Number.isNaN(start.getTime())) {
                start.setHours(0, 0, 0, 0);
                createdAtRange[Op.gte] = start;
            }
        }

        if (endRaw) {
            const end = new Date(endRaw);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                createdAtRange[Op.lte] = end;
            }
        }

        if (Object.keys(createdAtRange).length > 0) {
            whereClause.createdAt = createdAtRange;
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                { model: Invoice },
                { model: User, as: 'Customer', attributes: ['id', 'name'] },
                { model: User, as: 'Courier', attributes: ['id', 'name'] },
                { model: OrderIssue, as: 'Issues', where: { status: 'open' }, required: false },
            ],
            distinct: true,
            subQuery: false,
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        const rows = orders.rows.map((row) => withOrderTrackingFields(row.get({ plain: true }) as any));

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getDeliveryEmployees = async (_req: Request, res: Response) => {
    try {
        const employees = await User.findAll({
            where: {
                status: 'active',
                role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'role', 'whatsapp_number'],
            order: [['name', 'ASC']]
        });

        res.json({
            employees: employees.map((item) => {
                const plain = item.get({ plain: true }) as any;
                return {
                    ...plain,
                    display_name: resolveEmployeeDisplayName(plain)
                };
            })
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching delivery employees', error });
    }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userRole = req.user!.role;
        const { status, courier_id, issue_type, issue_note } = req.body;

        const nextStatus = typeof status === 'string' ? status : '';
        if (!ORDER_STATUS_OPTIONS.includes(nextStatus as (typeof ORDER_STATUS_OPTIONS)[number])) {
            await t.rollback();
            return res.status(400).json({ message: 'Status order tidak valid' });
        }

        const order = await Order.findByPk(orderId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        // --- STRICT TRANSITION MAP ---
        // Other transitions are handled by dedicated endpoints:
        //   pending → waiting_invoice              (allocateOrder)
        //   waiting_invoice → waiting_payment/ready_to_ship  (issueInvoice)
        //   waiting_payment → ready_to_ship         (verifyPayment)
        //   shipped → delivered                     (completeDelivery)
        const ALLOWED_TRANSITIONS: Record<string, { roles: string[]; to: string[] }> = {
            'ready_to_ship': { roles: ['admin_gudang'], to: ['shipped'] },
            'delivered': { roles: ['admin_gudang', 'admin_finance'], to: ['completed'] },
        };
        const CANCELABLE_STATUSES = [
            'pending',
            'waiting_invoice',
            'waiting_payment',
            'ready_to_ship',
            'allocated',
            'partially_fulfilled',
            'debt_pending',
            'processing',
            'hold',
        ];
        const canCancelByRole = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole);

        if (userRole !== 'super_admin') {
            if (nextStatus === 'canceled') {
                if (!canCancelByRole || !CANCELABLE_STATUSES.includes(order.status)) {
                    await t.rollback();
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa membatalkan order dengan status '${order.status}'.`
                    });
                }
            } else {
                const rule = ALLOWED_TRANSITIONS[order.status];
                if (!rule || !rule.roles.includes(userRole) || !rule.to.includes(nextStatus)) {
                    await t.rollback();
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa mengubah status dari '${order.status}' ke '${nextStatus}'. Gunakan fitur yang sesuai (alokasi, invoice, verifikasi).`
                    });
                }
            }
        }

        // --- Courier validation for shipped ---
        let courierIdToSave: string | null = null;
        if (nextStatus === 'shipped') {
            if (typeof courier_id !== 'string' || !courier_id.trim()) {
                await t.rollback();
                return res.status(400).json({ message: 'Status dikirim wajib memilih driver/kurir' });
            }
            const courier = await User.findOne({
                where: {
                    id: courier_id.trim(),
                    status: 'active',
                    role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
                },
                transaction: t
            });
            if (!courier) {
                await t.rollback();
                return res.status(404).json({ message: 'Driver/kurir tidak ditemukan atau tidak aktif' });
            }
            courierIdToSave = courier.id;
        }

        const updatePayload: any = { status: nextStatus };
        if (courierIdToSave) {
            updatePayload.courier_id = courierIdToSave;
        }
        await order.update(updatePayload, { transaction: t });

        // --- Issue tracking for hold ---
        if (nextStatus === 'hold') {
            const normalizedIssueType = typeof issue_type === 'string' && issue_type.trim()
                ? issue_type.trim()
                : 'shortage';
            if (normalizedIssueType !== 'shortage') {
                await t.rollback();
                return res.status(400).json({ message: 'Issue type tidak valid.' });
            }
            const dueAt = new Date(Date.now() + (ISSUE_SLA_HOURS * 60 * 60 * 1000));
            const existingOpenIssue = await OrderIssue.findOne({
                where: { order_id: orderId, status: 'open', issue_type: 'shortage' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            if (existingOpenIssue) {
                await existingOpenIssue.update({ note: normalizeIssueNote(issue_note) }, { transaction: t });
            } else {
                await OrderIssue.create({
                    order_id: orderId, issue_type: 'shortage', status: 'open',
                    note: normalizeIssueNote(issue_note), due_at: dueAt,
                    created_by: req.user?.id || null,
                }, { transaction: t });
            }
        } else {
            const openIssues = await OrderIssue.findAll({
                where: { order_id: orderId, status: 'open' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            for (const issue of openIssues) {
                await issue.update({
                    status: 'resolved', resolved_at: new Date(),
                    resolved_by: req.user?.id || null,
                }, { transaction: t });
            }
        }

        // If canceled, restore stock from allocations
        if (nextStatus === 'canceled' && order.stock_released === false) {
            const allocations = await OrderAllocation.findAll({
                where: { order_id: orderId }, transaction: t
            });
            for (const alloc of allocations) {
                if (alloc.allocated_qty > 0) {
                    const product = await Product.findByPk(alloc.product_id, {
                        transaction: t, lock: t.LOCK.UPDATE
                    });
                    if (product) {
                        await product.update({
                            stock_quantity: product.stock_quantity + alloc.allocated_qty,
                            allocated_quantity: Math.max(0, product.allocated_quantity - alloc.allocated_qty),
                        }, { transaction: t });
                    }
                }
            }
            await order.update({ stock_released: true }, { transaction: t });
        }

        await t.commit();
        res.json({ message: `Order status updated to ${nextStatus}` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating status', error });
    }
};

export const getDashboardStats = async (req: Request, res: Response) => {
    try {
        const counts = await Order.findAll({
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['status'],
            raw: true
        }) as unknown as { status: string, count: number }[];

        const stats = {
            pending: 0,
            waiting_invoice: 0,
            waiting_payment: 0,
            delivered: 0,
            ready_to_ship: 0,
            shipped: 0,
            completed: 0,
            canceled: 0,
            total: 0
        };

        counts.forEach(item => {
            if (item.status && (stats as any)[item.status] !== undefined) {
                (stats as any)[item.status] = Number(item.count);
            }
            stats.total += Number(item.count);
        });

        res.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: 'Error fetching stats', error });
    }
};
