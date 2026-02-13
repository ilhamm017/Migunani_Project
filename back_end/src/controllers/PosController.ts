import { Request, Response } from 'express';
import { Shift, Order, OrderItem, Product, Invoice, User, CustomerProfile, sequelize } from '../models';
import { Op } from 'sequelize';

// --- Shift Management ---

export const startShift = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id; // Kasir
        const { start_cash } = req.body;

        // Check if there is already an open shift
        const openShift = await Shift.findOne({
            where: { user_id: userId, status: 'open' }
        });

        if (openShift) {
            return res.status(400).json({ message: 'You already have an open shift', shiftId: openShift.id });
        }

        const shift = await Shift.create({
            user_id: userId,
            start_cash: Number(start_cash),
            status: 'open',
            start_time: new Date()
        });

        res.status(201).json({ message: 'Shift started', shift });
    } catch (error) {
        res.status(500).json({ message: 'Error starting shift', error });
    }
};

export const endShift = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const { end_cash } = req.body; // Actual cash counted

        const shift = await Shift.findOne({
            where: { user_id: userId, status: 'open' }
        });

        if (!shift) {
            return res.status(404).json({ message: 'No open shift found' });
        }

        const endTime = new Date();

        // Calculate Expected Cash
        // Formula: Start Cash + Total Sales (Cash) during shift

        // Find all orders completed/paid during this shift by this user (or generally in store if single register?)
        // Usually shift is per user.
        // We look for Invoices verified_by this user OR orders created by this user?
        // POS orders usually: created_by = Kasir. But our Order schema has `customer_id`. 
        // We assume Walk-in Customer: customer_id = NULL or Generic Guest, but who served it? 
        // We didn't add `served_by` or `cashier_id` to Order. We have `verified_by` in Invoice.
        // Let's use Invoice.verified_by = userId AND method = 'cash_store'

        const cashSales = await Invoice.sum('amount_paid', {
            where: {
                payment_method: 'cash_store',
                verified_by: userId,
                payment_status: 'paid',
                verified_at: {
                    [Op.between]: [shift.start_time, endTime]
                }
            }
        }) || 0;

        const expectedCash = Number(shift.start_cash) + Number(cashSales);
        const difference = Number(end_cash) - expectedCash;

        await shift.update({
            end_time: endTime,
            end_cash: Number(end_cash),
            expected_cash: expectedCash,
            difference,
            status: 'closed'
        });

        res.json({
            message: 'Shift closed',
            summary: {
                start_cash: shift.start_cash,
                cash_sales: cashSales,
                expected_cash: expectedCash,
                actual_cash: end_cash,
                difference
            }
        });

    } catch (error) {
        res.status(500).json({ message: 'Error closing shift', error });
    }
};

// --- Transaction Management ---

// Hold Order: Create order with status 'hold'. Items are deducted?
// Usually Hold Order DEDUCTS stock to reserve it, OR just keeps it 'active' but not paid.
// Let's reserve stock (deduct) to prevent overselling.
export const holdOrder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { items, customer_name } = req.body;
        // items: [{ product_id, qty }]

        let totalAmount = 0;
        const orderItemsData = [];

        for (const item of items) {
            const product = await Product.findByPk(item.product_id, { transaction: t });
            if (!product) throw new Error(`Product ${item.product_id} not found`);

            if (product.stock_quantity < item.qty) {
                throw new Error(`Insufficient stock for ${product.name}`);
            }

            await product.update({ stock_quantity: product.stock_quantity - item.qty }, { transaction: t });

            totalAmount += Number(product.price) * item.qty;
            orderItemsData.push({
                product_id: product.id,
                qty: item.qty,
                price_at_purchase: product.price,
                cost_at_purchase: product.base_price
            });
        }

        const order = await Order.create({
            customer_name: customer_name || 'Walk-in Guest',
            source: 'pos_store',
            status: 'hold',
            total_amount: totalAmount,
            stock_released: false // Stock IS Reserved (so NOT released back)
        }, { transaction: t });

        for (const itemData of orderItemsData) {
            await OrderItem.create({ order_id: order.id, ...itemData }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Order held', order_id: order.id });

    } catch (error: any) {
        await t.rollback();
        res.status(400).json({ message: error.message || 'Error holding order' });
    }
};

export const getHoldOrders = async (req: Request, res: Response) => {
    try {
        const orders = await Order.findAll({
            where: { status: 'hold' },
            include: [{ model: OrderItem, include: [Product] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching hold orders', error });
    }
};

export const resumeOrder = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(String(id), {
            include: [{ model: OrderItem, include: [Product] }]
        });

        if (!order || order.status !== 'hold') {
            return res.status(404).json({ message: 'Hold order not found' });
        }

        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error resuming order', error });
    }
};

export const voidTransaction = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const order = await Order.findByPk(String(id));

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status === 'canceled') {
            await t.rollback();
            return res.status(400).json({ message: 'Order already canceled' });
        }

        // Return stock
        if (!order.stock_released) {
            const items = await OrderItem.findAll({ where: { order_id: id }, transaction: t });
            for (const item of items) {
                const product = await Product.findByPk(item.product_id, { transaction: t });
                if (product) {
                    await product.update({ stock_quantity: product.stock_quantity + item.qty }, { transaction: t });
                }
            }
        }

        await order.update({ status: 'canceled', stock_released: true }, { transaction: t });

        // If Invoice exists, void it too?
        await Invoice.update(
            { payment_status: 'unpaid', amount_paid: 0 },
            { where: { order_id: id }, transaction: t }
        );

        await t.commit();
        res.json({ message: 'Transaction voided' });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error voiding transaction', error });
    }
};

export const searchCustomers = async (req: Request, res: Response) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (query.length < 2) {
            return res.json({ customers: [] });
        }

        const customers = await User.findAll({
            where: {
                role: 'customer',
                status: 'active',
                [Op.or]: [
                    { name: { [Op.like]: `%${query}%` } },
                    { whatsapp_number: { [Op.like]: `%${query}%` } },
                    { email: { [Op.like]: `%${query}%` } }
                ]
            },
            attributes: ['id', 'name', 'email', 'whatsapp_number'],
            order: [['name', 'ASC']],
            limit: 20
        });

        return res.json({ customers });
    } catch (error) {
        return res.status(500).json({ message: 'Error mencari customer', error });
    }
};

export const checkoutOrder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id;
        const { items, customer_name, customer_whatsapp, payment_method, cash_received } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Item transaksi wajib diisi' });
        }

        const normalizedPaymentMethod = typeof payment_method === 'string'
            ? payment_method.trim().toLowerCase()
            : '';
        if (!['cash', 'transfer', 'debt'].includes(normalizedPaymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran tidak valid (cash/transfer/debt)' });
        }

        const inputCustomerName = typeof customer_name === 'string' && customer_name.trim()
            ? customer_name.trim()
            : 'Walk-in Guest';
        const normalizedCustomerWhatsapp = typeof customer_whatsapp === 'string' && customer_whatsapp.trim()
            ? customer_whatsapp.trim()
            : '';

        let customerUser: any = null;
        if (normalizedCustomerWhatsapp) {
            customerUser = await User.findOne({
                where: {
                    role: 'customer',
                    status: 'active',
                    whatsapp_number: normalizedCustomerWhatsapp
                },
                transaction: t
            });
        }

        const normalizedCustomerName = customerUser?.name ? String(customerUser.name) : inputCustomerName;
        const resolvedCustomerId = customerUser?.id ? String(customerUser.id) : null;

        if (normalizedPaymentMethod === 'debt' && normalizedCustomerName.toLowerCase() === 'walk-in guest') {
            await t.rollback();
            return res.status(400).json({ message: 'Pembayaran utang wajib isi nama customer' });
        }

        let totalAmount = 0;
        const orderItemsData: Array<{
            product_id: string;
            qty: number;
            price_at_purchase: number;
            cost_at_purchase: number;
        }> = [];

        for (const rawItem of items) {
            const productId = String(rawItem?.product_id || '').trim();
            const qty = Number(rawItem?.qty || 0);
            if (!productId || !Number.isInteger(qty) || qty <= 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Format item tidak valid' });
            }

            const product = await Product.findByPk(productId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (!product) {
                await t.rollback();
                return res.status(404).json({ message: `Produk ${productId} tidak ditemukan` });
            }

            if (product.stock_quantity < qty) {
                await t.rollback();
                return res.status(400).json({ message: `Stok ${product.name} tidak mencukupi` });
            }

            await product.update({
                stock_quantity: product.stock_quantity - qty
            }, { transaction: t });

            const productPrice = Number(product.price || 0);
            totalAmount += productPrice * qty;
            orderItemsData.push({
                product_id: String(product.id),
                qty,
                price_at_purchase: productPrice,
                cost_at_purchase: Number(product.base_price || 0)
            });
        }

        const orderStatus = normalizedPaymentMethod === 'debt' ? 'debt_pending' : 'completed';
        const order = await Order.create({
            customer_id: resolvedCustomerId || undefined,
            customer_name: normalizedCustomerName,
            source: 'pos_store',
            status: orderStatus,
            total_amount: totalAmount,
            discount_amount: 0,
            stock_released: false
        }, { transaction: t });

        for (const itemData of orderItemsData) {
            await OrderItem.create({
                order_id: order.id,
                ...itemData
            }, { transaction: t });
        }

        let invoicePaymentMethod: 'cash_store' | 'transfer_manual';
        let invoicePaymentStatus: 'paid' | 'unpaid';
        let amountPaid = 0;
        let changeAmount = 0;
        let verifiedBy: string | null = null;
        let verifiedAt: Date | null = null;

        if (normalizedPaymentMethod === 'cash') {
            const received = Number(cash_received || 0);
            if (!Number.isFinite(received) || received < totalAmount) {
                await t.rollback();
                return res.status(400).json({ message: 'Uang tunai diterima kurang dari total belanja' });
            }

            invoicePaymentMethod = 'cash_store';
            invoicePaymentStatus = 'paid';
            amountPaid = received;
            changeAmount = received - totalAmount;
            verifiedBy = userId;
            verifiedAt = new Date();
        } else if (normalizedPaymentMethod === 'transfer') {
            invoicePaymentMethod = 'transfer_manual';
            invoicePaymentStatus = 'paid';
            amountPaid = totalAmount;
            changeAmount = 0;
            verifiedBy = userId;
            verifiedAt = new Date();
        } else {
            invoicePaymentMethod = 'transfer_manual';
            invoicePaymentStatus = 'unpaid';
            amountPaid = 0;
            changeAmount = 0;
            verifiedBy = null;
            verifiedAt = null;
        }

        const invoiceNumber = `POS/${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}/${Date.now().toString().slice(-6)}`;
        const invoice = await Invoice.create({
            order_id: order.id,
            invoice_number: invoiceNumber,
            payment_method: invoicePaymentMethod,
            payment_status: invoicePaymentStatus,
            amount_paid: amountPaid,
            change_amount: changeAmount,
            verified_by: verifiedBy,
            verified_at: verifiedAt
        }, { transaction: t });

        let pointsEarned = 0;
        if (customerUser && normalizedPaymentMethod !== 'debt') {
            pointsEarned = Math.floor(totalAmount / 10000);
            if (pointsEarned > 0) {
                const [profile] = await CustomerProfile.findOrCreate({
                    where: { user_id: String(customerUser.id) },
                    defaults: {
                        user_id: String(customerUser.id),
                        tier: 'regular',
                        points: 0,
                        saved_addresses: []
                    },
                    transaction: t
                });

                await profile.update({
                    points: Number(profile.points || 0) + pointsEarned
                }, { transaction: t });
            }
        }

        await t.commit();

        return res.status(201).json({
            message: 'Checkout POS berhasil',
            order_id: order.id,
            order_status: order.status,
            total_amount: totalAmount,
            customer: {
                customer_id: resolvedCustomerId,
                customer_name: normalizedCustomerName,
                customer_whatsapp: customerUser?.whatsapp_number || normalizedCustomerWhatsapp || null,
                is_registered: !!customerUser
            },
            points_earned: pointsEarned,
            invoice: {
                id: invoice.id,
                invoice_number: invoice.invoice_number,
                payment_method: invoice.payment_method,
                payment_status: invoice.payment_status,
                amount_paid: Number(invoice.amount_paid),
                change_amount: Number(invoice.change_amount)
            }
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal checkout POS', error });
    }
};
