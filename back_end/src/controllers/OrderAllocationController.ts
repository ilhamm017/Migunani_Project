import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, Invoice, OrderIssue, Backorder } from '../models';

const REALLOCATABLE_STATUSES = ['pending', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;
const TERMINAL_ORDER_STATUSES = ['completed', 'canceled', 'expired'] as const;
const ALLOCATION_EDITABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;

const buildShortageSummary = (orderItemsRaw: any[], allocationsRaw: any[]) => {
    const orderItems = Array.isArray(orderItemsRaw) ? orderItemsRaw : [];
    const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : [];

    const orderedByProduct = new Map<string, number>();
    const productNameByProduct = new Map<string, string>();
    orderItems.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        const prev = orderedByProduct.get(key) || 0;
        orderedByProduct.set(key, prev + Number(item?.qty || 0));
        if (!productNameByProduct.has(key)) {
            productNameByProduct.set(key, String(item?.Product?.name || 'Produk'));
        }
    });

    const allocatedByProduct = new Map<string, number>();
    allocations.forEach((allocation: any) => {
        const key = String(allocation?.product_id || '');
        if (!key) return;
        const prev = allocatedByProduct.get(key) || 0;
        allocatedByProduct.set(key, prev + Number(allocation?.allocated_qty || 0));
    });

    let orderedTotal = 0;
    let allocatedTotal = 0;
    let shortageTotal = 0;

    const shortageItems = Array.from(orderedByProduct.entries())
        .map(([productId, orderedQty]) => {
            const allocatedQty = Number(allocatedByProduct.get(productId) || 0);
            const shortageQty = Math.max(0, Number(orderedQty || 0) - allocatedQty);

            orderedTotal += Number(orderedQty || 0);
            allocatedTotal += Math.min(Number(orderedQty || 0), allocatedQty);
            shortageTotal += shortageQty;

            if (shortageQty <= 0) return null;
            return {
                product_id: productId,
                product_name: productNameByProduct.get(productId) || 'Produk',
                ordered_qty: Number(orderedQty || 0),
                allocated_qty: allocatedQty,
                shortage_qty: shortageQty,
            };
        })
        .filter(Boolean);

    return {
        orderedTotal,
        allocatedTotal,
        shortageTotal,
        shortageItems,
    };
};

export const getPendingAllocations = async (req: Request, res: Response) => {
    try {
        const scope = String(req.query?.scope || 'shortage').toLowerCase();
        const includeAllOpenOrders = scope === 'all';

        const orders = await Order.findAll({
            where: {
                status: { [Op.notIn]: TERMINAL_ORDER_STATUSES as unknown as string[] }
            },
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name'] },
                { model: OrderItem, include: [{ model: Product, attributes: ['id', 'name', 'stock_quantity', 'allocated_quantity'] }] },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            order: [['createdAt', 'ASC']] // FIFO
        });

        const rows = orders
            .map((order: any) => {
                const plain = order.get({ plain: true });
                const { orderedTotal, allocatedTotal, shortageTotal, shortageItems } = buildShortageSummary(plain.OrderItems, plain.Allocations);
                const needsAllocation = shortageTotal > 0;

                return {
                    ...plain,
                    ordered_total: orderedTotal,
                    allocated_total: allocatedTotal,
                    shortage_total: shortageTotal,
                    needs_allocation: needsAllocation,
                    is_backorder: needsAllocation && allocatedTotal > 0,
                    status_label: !needsAllocation ? 'fulfilled' : (allocatedTotal > 0 ? 'backorder' : 'preorder'),
                    shortage_items: shortageItems,
                };
            })
            .filter((row: any) => includeAllOpenOrders || row.needs_allocation);

        res.json({
            scope: includeAllOpenOrders ? 'all' : 'shortage',
            rows,
        });
    } catch (error) {
        console.error('Error fetching pending allocations:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getProductAllocations = async (req: Request, res: Response) => {
    try {
        const { productId } = req.params as { productId: string };
        if (!productId || !String(productId).trim()) {
            return res.status(400).json({ message: 'productId wajib diisi' });
        }

        const allocations = await OrderAllocation.findAll({
            where: {
                product_id: productId,
                allocated_qty: { [Op.gt]: 0 }
            },
            include: [
                {
                    model: Order,
                    attributes: ['id', 'status', 'customer_name', 'createdAt'],
                    include: [
                        { model: User, as: 'Customer', attributes: ['id', 'name'], required: false },
                        { model: Invoice, attributes: ['invoice_number', 'payment_status'], required: false }
                    ],
                    required: false
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const closedOrderStatuses = new Set(['completed', 'canceled', 'expired']);

        const rows = allocations.map((item: any) => {
            const order = item.Order;
            const customerName = order?.Customer?.name || order?.customer_name || 'Customer';
            const orderStatus = String(order?.status || '').toLowerCase();

            return {
                allocation_id: item.id,
                allocated_qty: Number(item.allocated_qty || 0),
                allocation_status: item.status,
                order_id: order?.id || null,
                order_status: order?.status || null,
                order_created_at: order?.createdAt || null,
                customer_name: customerName,
                invoice_number: order?.Invoice?.invoice_number || null,
                payment_status: order?.Invoice?.payment_status || null,
                is_order_open: orderStatus ? !closedOrderStatuses.has(orderStatus) : true,
            };
        });

        const totalAllocated = rows.reduce((sum: number, row: any) => sum + Number(row.allocated_qty || 0), 0);
        const openAllocated = rows
            .filter((row: any) => row.is_order_open)
            .reduce((sum: number, row: any) => sum + Number(row.allocated_qty || 0), 0);

        return res.json({
            product_id: productId,
            total_allocated: totalAllocated,
            open_allocated: openAllocated,
            order_count: rows.length,
            rows
        });
    } catch (error) {
        console.error('Error fetching product allocations:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOrderDetails = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name', 'email', 'whatsapp_number'] },
                {
                    model: OrderItem,
                    include: [{ model: Product, attributes: ['id', 'name', 'sku', 'stock_quantity', 'allocated_quantity'] }]
                },
                { model: OrderAllocation, as: 'Allocations' }
            ]
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const allocateOrder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const { items } = req.body as { items: Array<{ product_id: string; qty: number }> }; // Qty to allocate

        const order = await Order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        if (!(REALLOCATABLE_STATUSES as readonly string[]).includes(order.status)) {
            await t.rollback();
            return res.status(400).json({ message: `Order dengan status '${order.status}' tidak bisa dialokasikan` });
        }
        if (!(ALLOCATION_EDITABLE_STATUSES as readonly string[]).includes(order.status)) {
            await t.rollback();
            return res.status(400).json({
                message: `Alokasi dikunci karena order sudah masuk proses finance/pengiriman (status: '${order.status}').`
            });
        }

        for (const item of items) {
            const product = await Product.findByPk(item.product_id, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (!product) continue;

            // Get existing allocation (if any)
            const [allocation] = await OrderAllocation.findOrCreate({
                where: { order_id: id, product_id: item.product_id },
                defaults: {
                    order_id: id,
                    product_id: item.product_id,
                    allocated_qty: 0,
                    status: 'pending'
                },
                transaction: t
            });

            const previouslyAllocated = Number(allocation.allocated_qty || 0);
            const delta = Number(item.qty) - previouslyAllocated;

            // Check actual physical stock availability for additional quantity
            if (delta > 0 && delta > product.stock_quantity) {
                await t.rollback();
                return res.status(400).json({
                    message: `Stok tidak cukup untuk ${product.name}. Fisik tersedia: ${product.stock_quantity}, tambahan yang diminta: ${delta}`
                });
            }

            if (delta > 0) {
                // Allocating more: decrement stock_quantity
                await product.update({
                    stock_quantity: product.stock_quantity - delta,
                    allocated_quantity: product.allocated_quantity + delta,
                }, { transaction: t });
            } else if (delta < 0) {
                // Reducing allocation: return stock
                const absDelta = Math.abs(delta);
                await product.update({
                    stock_quantity: product.stock_quantity + absDelta,
                    allocated_quantity: Math.max(0, product.allocated_quantity - absDelta),
                }, { transaction: t });
            }

            await allocation.update({ allocated_qty: item.qty }, { transaction: t });
        }

        // --- Determine fulfillment status ---
        const orderItems = await OrderItem.findAll({ where: { order_id: id }, transaction: t });
        const allocations = await OrderAllocation.findAll({ where: { order_id: id }, transaction: t });

        let fullyAllocated = true;
        let partiallyAllocated = false;

        for (const oi of orderItems) {
            const alloc = allocations.find(a => a.product_id === oi.product_id);
            const allocQty = alloc ? alloc.allocated_qty : 0;
            if (allocQty < oi.qty) fullyAllocated = false;
            if (allocQty > 0) partiallyAllocated = true;
        }

        // --- Recalculate total based on what's actually allocated ---
        let allocatedTotal = 0;
        for (const oi of orderItems) {
            const alloc = allocations.find(a => a.product_id === oi.product_id);
            const allocQty = alloc ? alloc.allocated_qty : 0;
            allocatedTotal += Number(oi.price_at_purchase) * allocQty;
        }
        await order.update({ total_amount: allocatedTotal }, { transaction: t });

        // --- Auto-transition order & invoice status based on payment method ---
        const invoice = await Invoice.findOne({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (fullyAllocated || partiallyAllocated) {
            const statusProgressRank: Record<string, number> = {
                pending: 1,
                allocated: 1,
                partially_fulfilled: 1,
                debt_pending: 1,
                hold: 1,
                waiting_invoice: 2,
                waiting_payment: 3,
                ready_to_ship: 4,
                shipped: 5,
                delivered: 6,
                completed: 7,
                canceled: 7,
                expired: 7,
            };
            const currentRank = Number(statusProgressRank[order.status] || 0);
            const waitingInvoiceRank = Number(statusProgressRank.waiting_invoice);
            const nextStatus = currentRank >= waitingInvoiceRank ? order.status : 'waiting_invoice';

            if (nextStatus !== order.status) {
                await order.update({ status: nextStatus }, { transaction: t });
            }

            if (invoice) {
                // Keep invoice in draft — Finance will issue it
            }
        }

        // --- Build response with backorder info ---
        const backorderItems = orderItems
            .map(oi => {
                const alloc = allocations.find(a => a.product_id === oi.product_id);
                const allocQty = alloc ? alloc.allocated_qty : 0;
                const shortage = oi.qty - allocQty;
                return shortage > 0 ? { product_id: oi.product_id, ordered: oi.qty, allocated: allocQty, shortage } : null;
            })
            .filter(Boolean);

        // --- Manage Backorders & Order Issues ---
        const hasShortage = backorderItems.length > 0;
        const now = new Date();

        // 1. Update Backorder Records
        for (const oi of orderItems) {
            const alloc = allocations.find(a => a.product_id === oi.product_id);
            const allocQty = alloc ? alloc.allocated_qty : 0;
            const shortageRaw = oi.qty - allocQty;
            const shortage = shortageRaw > 0 ? shortageRaw : 0;

            const [backorder, created] = await Backorder.findOrCreate({
                where: { order_item_id: oi.id },
                defaults: {
                    order_item_id: oi.id,
                    qty_pending: shortage,
                    status: 'waiting_stock'
                },
                transaction: t
            });

            if (shortage > 0) {
                // If backorder exists or just created, ensure status and qty
                if (!created || backorder.qty_pending !== shortage) {
                    await backorder.update({
                        qty_pending: shortage,
                        status: 'waiting_stock' // Re-open if it was canceled/fulfilled but now has shortage?
                    }, { transaction: t });
                }
            } else {
                // No shortage -> Fulfilled
                if (backorder.status !== 'fulfilled' && backorder.status !== 'canceled') {
                    await backorder.update({
                        qty_pending: 0,
                        status: 'fulfilled'
                    }, { transaction: t });
                }
            }
        }

        // 2. Manage Order Issues (Legacy Shortage Tracking - Optional but good for visibility)
        if (hasShortage) {
            // Create or update open shortage issue
            const existingIssue = await OrderIssue.findOne({
                where: { order_id: id, issue_type: 'shortage', status: 'open' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            const shortageNote = (backorderItems as Array<{ product_id: string; shortage: number }>).map(b => `${b.product_id}: kurang ${b.shortage}`).join(', ');

            if (existingIssue) {
                await existingIssue.update({ note: shortageNote }, { transaction: t });
            } else {
                const dueAt = new Date(now.getTime() + (48 * 60 * 60 * 1000)); // Default 48h SLA
                await OrderIssue.create({
                    order_id: id,
                    issue_type: 'shortage',
                    status: 'open',
                    note: shortageNote,
                    due_at: dueAt,
                    created_by: req.user?.id || null
                }, { transaction: t });
            }
        } else {
            // Resolve any open shortage issues
            const openIssues = await OrderIssue.findAll({
                where: { order_id: id, issue_type: 'shortage', status: 'open' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            for (const issue of openIssues) {
                await issue.update({
                    status: 'resolved',
                    resolved_at: now,
                    resolved_by: req.user?.id || null
                }, { transaction: t });
            }
        }

        await t.commit();
        res.json({
            message: 'Alokasi berhasil',
            status: fullyAllocated ? 'fully_allocated' : 'partially_allocated',
            allocated_total: allocatedTotal,
            backorder_items: backorderItems,
        });

    } catch (error) {
        await t.rollback();
        console.error('Allocation error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const cancelBackorder = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const reason = reasonRaw.trim();

        if (!reason) {
            await t.rollback();
            return res.status(400).json({ message: 'Alasan cancel wajib diisi.' });
        }

        const order = await Order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan.' });
        }

        if (!(REALLOCATABLE_STATUSES as readonly string[]).includes(order.status)) {
            await t.rollback();
            return res.status(400).json({ message: `Order dengan status '${order.status}' tidak bisa cancel backorder.` });
        }

        const orderItems = await OrderItem.findAll({
            where: { order_id: id },
            include: [{ model: Product, attributes: ['id', 'name'], required: false }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const allocations = await OrderAllocation.findAll({ where: { order_id: id }, transaction: t, lock: t.LOCK.UPDATE });

        const { shortageItems } = buildShortageSummary(
            orderItems.map((item: any) => item.get({ plain: true })),
            allocations.map((allocation: any) => allocation.get({ plain: true }))
        );

        if (shortageItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Order ini tidak memiliki kekurangan alokasi (bukan backorder/pre-order).' });
        }

        if (order.stock_released === false) {
            for (const alloc of allocations) {
                const allocatedQty = Number(alloc.allocated_qty || 0);
                if (allocatedQty <= 0) continue;

                const product = await Product.findByPk(alloc.product_id, { transaction: t, lock: t.LOCK.UPDATE });
                if (!product) continue;

                await product.update({
                    stock_quantity: Number(product.stock_quantity || 0) + allocatedQty,
                    allocated_quantity: Math.max(0, Number(product.allocated_quantity || 0) - allocatedQty),
                }, { transaction: t });
            }
        }

        // --- Update Backorder Records Status to canceled ---
        for (const item of orderItems) {
            const backorder = await Backorder.findOne({
                where: { order_item_id: item.id },
                transaction: t
            });

            if (backorder) {
                await backorder.update({ status: 'canceled', notes: `Reason: ${reason}` }, { transaction: t });
            }
        }

        const openIssues = await OrderIssue.findAll({
            where: { order_id: id, status: 'open' },
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

        const now = new Date();
        await OrderIssue.create({
            order_id: id,
            issue_type: 'shortage',
            status: 'resolved',
            note: `[CANCEL_BACKORDER] ${reason}`,
            due_at: now,
            resolved_at: now,
            created_by: req.user?.id || null,
            resolved_by: req.user?.id || null,
        }, { transaction: t });

        await order.update({
            status: 'canceled',
            stock_released: true
        }, { transaction: t });

        await t.commit();
        return res.json({
            message: 'Backorder / pre-order berhasil dibatalkan.',
            order_id: id,
            canceled_reason: reason,
            shortage_items: shortageItems,
        });
    } catch (error) {
        await t.rollback();
        console.error('Error canceling backorder:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};
