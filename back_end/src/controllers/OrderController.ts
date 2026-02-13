import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, Cart, CartItem, User, sequelize } from '../models';
import { Op } from 'sequelize';

// --- Customer Endpoints ---
const DELIVERY_EMPLOYEE_ROLES = ['driver'] as const;
const ORDER_STATUS_OPTIONS = ['pending', 'waiting_payment', 'processing', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'hold'] as const;
const ISSUE_SLA_HOURS = 48;

const GENERIC_CUSTOMER_NAMES = new Set([
    'customer',
    'super_admin',
    'admin_gudang',
    'admin_finance',
    'kasir',
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

export const checkout = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id; // Authenticated user
        const { items, payment_method, from_cart } = req.body;
        // items: [{ product_id, qty }]
        // payment_method: 'transfer_manual' | 'cod'
        // from_cart: boolean

        let finalItems = items;

        if (from_cart) {
            const cart = await Cart.findOne({
                where: { user_id: userId },
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

        // Validate Stock & Calculate Total
        for (const item of finalItems) {
            // Lock the row for update to prevent race conditions
            const product = await Product.findByPk(item.product_id, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (!product) {
                await t.rollback();
                return res.status(404).json({ message: `Product ${item.product_id} not found` });
            }

            if (product.stock_quantity < item.qty) {
                await t.rollback();
                return res.status(400).json({ message: `Insufficient stock for ${product.name}. Available: ${product.stock_quantity}` });
            }

            // Decrement stock (Reserved)
            await product.update({ stock_quantity: product.stock_quantity - item.qty }, { transaction: t });

            // Calculate Price (Snapshot)
            const priceAtPurchase = Number(product.price);
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

        const customer = await User.findByPk(userId, {
            attributes: ['name'],
            transaction: t
        });
        const customerName = typeof customer?.name === 'string' && customer.name.trim()
            ? customer.name.trim()
            : 'Customer';

        // Create Order
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30); // 30 Days expiry

        const order = await Order.create({
            customer_id: userId,
            customer_name: customerName,
            source: 'web',
            status: payment_method === 'cod' ? 'processing' : 'pending', // COD doesn't need payment proof to process packing? Or waiting_payment?
            // "Menunggu Verifikasi" usually for Transfer. COD is "Processing"?
            // Let's keep 'pending' for consistency, or 'processing' if confirmed.
            // If COD, we usually confirm via WA? 
            // Let's use 'pending' as default.
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
            payment_status: 'unpaid',
            amount_paid: 0,
            change_amount: 0
        }, { transaction: t });

        await t.commit();

        // If successful and from_cart, clear the cart
        if (from_cart) {
            const cart = await Cart.findOne({ where: { user_id: userId } });
            if (cart) {
                await CartItem.destroy({ where: { cart_id: cart.id } });
            }
        }

        res.status(201).json({
            message: 'Order placed successfully',
            order_id: order.id,
            invoice_number: invoiceNumber,
            total_amount: totalAmount,
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
                { model: Invoice, attributes: ['invoice_number', 'payment_status', 'payment_method'] }
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
                { model: Invoice }
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
        if (status && status !== 'all') whereClause.status = status;

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
        const { status, courier_id, issue_type, issue_note } = req.body;
        // status: 'processing', 'shipped', 'delivered', 'completed', 'canceled'

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

        const invoice = await Invoice.findOne({
            where: { order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const needsPaidInvoice = ['processing', 'shipped', 'delivered', 'completed'].includes(nextStatus);
        const isManualTransfer = invoice.payment_method === 'transfer_manual';
        const isPaid = invoice.payment_status === 'paid';
        if (needsPaidInvoice && isManualTransfer && !isPaid) {
            await t.rollback();
            return res.status(409).json({
                message: 'Order transfer manual belum bisa diproses karena pembayaran belum diverifikasi admin finance'
            });
        }

        let courierIdToSave: string | null = null;
        if (nextStatus === 'shipped' && order.source !== 'pos_store') {
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

        if (nextStatus === 'hold') {
            const normalizedIssueType = typeof issue_type === 'string' && issue_type.trim()
                ? issue_type.trim()
                : 'shortage';

            if (normalizedIssueType !== 'shortage') {
                await t.rollback();
                return res.status(400).json({ message: 'Issue type tidak valid. Gunakan shortage untuk barang kurang.' });
            }

            const dueAt = new Date(Date.now() + (ISSUE_SLA_HOURS * 60 * 60 * 1000));
            const existingOpenIssue = await OrderIssue.findOne({
                where: { order_id: orderId, status: 'open', issue_type: 'shortage' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (existingOpenIssue) {
                await existingOpenIssue.update({
                    note: normalizeIssueNote(issue_note),
                }, { transaction: t });
            } else {
                await OrderIssue.create({
                    order_id: orderId,
                    issue_type: 'shortage',
                    status: 'open',
                    note: normalizeIssueNote(issue_note),
                    due_at: dueAt,
                    created_by: req.user?.id || null,
                }, { transaction: t });
            }
        } else {
            const openIssues = await OrderIssue.findAll({
                where: { order_id: orderId, status: 'open' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            for (const issue of openIssues) {
                await issue.update({
                    status: 'resolved',
                    resolved_at: new Date(),
                    resolved_by: req.user?.id || null,
                }, { transaction: t });
            }
        }

        // If canceled, we should restore stock!
        if (nextStatus === 'canceled' && order.stock_released === false) {
            // Need to fetch items and restore.
            // Simplified logic:
            const items = await OrderItem.findAll({
                where: { order_id: orderId },
                transaction: t
            });
            for (const item of items) {
                const product = await Product.findByPk(item.product_id, {
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                if (product) {
                    await product.update({
                        stock_quantity: product.stock_quantity + item.qty
                    }, { transaction: t });
                }
            }
            await order.update({ stock_released: true }, { transaction: t });
            // Add flag to order to prevent double restore? Order model schema has 'stock_released' (boolean). 
            // NOTE: 'stock_released' in schema means "Has the stock been released BACK to inventory?".
            // If we cancel, we set stock_released = true.
        }

        await t.commit();
        res.json({ message: `Order status updated to ${nextStatus}` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating status', error });
    }
};
