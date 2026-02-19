import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder } from '../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { attachInvoicesToOrders } from '../utils/invoiceLookup';


const REALLOCATABLE_STATUSES = ['pending', 'waiting_invoice', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;
const TERMINAL_ORDER_STATUSES = ['completed', 'canceled', 'expired'] as const;
const ALLOCATION_EDITABLE_STATUSES = ['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;

const buildShortageSummary = (orderItemsRaw: any[], allocationsRaw: any[]) => {
    const orderItems = Array.isArray(orderItemsRaw) ? orderItemsRaw : [];
    const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : [];

    const orderedByProduct = new Map<string, number>();
    const productNameByProduct = new Map<string, string>();
    const productDetailsByProduct = new Map<string, any>();
    orderItems.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        const prev = orderedByProduct.get(key) || 0;
        orderedByProduct.set(key, prev + Number(item?.qty || 0));
        if (!productNameByProduct.has(key)) {
            productNameByProduct.set(key, String(item?.Product?.name || 'Produk'));
        }
        // Store product details
        const details = {
            sku: item?.Product?.sku,
            base_price: item?.Product?.base_price,
            stock_quantity: item?.Product?.stock_quantity
        };
        if (!productDetailsByProduct.has(key)) {
            productDetailsByProduct.set(key, details);
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
            const details = productDetailsByProduct.get(productId) || {};
            return {
                product_id: productId,
                product_name: productNameByProduct.get(productId) || 'Produk',
                sku: details.sku,
                base_price: details.base_price,
                stock_quantity: details.stock_quantity,
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
                { model: OrderItem, include: [{ model: Product, attributes: ['id', 'name', 'sku', 'base_price', 'stock_quantity', 'allocated_quantity'] }] },
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
                    ],
                    required: false
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const orderMap = new Map<string, any>();
        allocations.forEach((item: any) => {
            const order = item.Order;
            if (order) orderMap.set(String(order.id), order);
        });
        const ordersWithInvoices = await attachInvoicesToOrders(
            Array.from(orderMap.values()).map((order: any) => order.get({ plain: true }) as any)
        );
        const invoiceByOrderId = new Map<string, any>();
        ordersWithInvoices.forEach((order: any) => {
            invoiceByOrderId.set(String(order.id), order.Invoice || null);
        });

        const closedOrderStatuses = new Set(['completed', 'canceled', 'expired']);

        const rows = allocations.map((item: any) => {
            const order = item.Order;
            const customerName = order?.Customer?.name || order?.customer_name || 'Customer';
            const orderStatus = String(order?.status || '').toLowerCase();
            const invoice = invoiceByOrderId.get(String(order?.id || '')) || null;

            return {
                allocation_id: item.id,
                allocated_qty: Number(item.allocated_qty || 0),
                allocation_status: item.status,
                order_id: order?.id || null,
                order_status: order?.status || null,
                order_created_at: order?.createdAt || null,
                customer_name: customerName,
                invoice_number: invoice?.invoice_number || null,
                payment_status: invoice?.payment_status || null,
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
    /**
     * KEBIJAKAN ALOKASI MANUAL:
     * Fungsi ini adalah satu-satunya titik masuk untuk alokasi stok ke pesanan.
     * Alokasi bersifat manual dan admin-triggered. Hindari penambahan alokasi otomatis 
     * yang tidak terpantau untuk menjaga kontrol penuh administrator terhadap prioritas pesanan.
     */
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

        // --- Determine fulfillment status (allocation is stored per product_id) ---
        const orderItems = await OrderItem.findAll({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const allocations = await OrderAllocation.findAll({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const allocatedByProduct = new Map<string, number>();
        for (const allocation of allocations) {
            const productId = String((allocation as any).product_id || '');
            if (!productId) continue;
            const prev = Number(allocatedByProduct.get(productId) || 0);
            allocatedByProduct.set(productId, prev + Number((allocation as any).allocated_qty || 0));
        }

        // Distribute product-level allocation to each order item row.
        const remainingAllocatedByProduct = new Map<string, number>(allocatedByProduct);
        const itemBreakdown = orderItems.map((oi: any) => {
            const productId = String(oi.product_id || '');
            const orderedQty = Number(oi.qty || 0);
            const remainingAllocated = Number(remainingAllocatedByProduct.get(productId) || 0);
            const allocatedQty = Math.min(orderedQty, Math.max(0, remainingAllocated));
            const shortageQty = Math.max(0, orderedQty - allocatedQty);
            remainingAllocatedByProduct.set(productId, Math.max(0, remainingAllocated - allocatedQty));

            return {
                oi,
                product_id: productId,
                ordered_qty: orderedQty,
                allocated_qty: allocatedQty,
                shortage_qty: shortageQty
            };
        });

        const fullyAllocated = itemBreakdown.every((row) => row.shortage_qty <= 0);
        const partiallyAllocated = itemBreakdown.some((row) => row.allocated_qty > 0);

        // --- Recalculate total based on what can be processed now ---
        const allocatedTotal = itemBreakdown.reduce((sum, row) => {
            return sum + (Number(row.oi.price_at_purchase || 0) * Number(row.allocated_qty || 0));
        }, 0);

        const backorderByProduct = new Map<string, { product_id: string; ordered: number; allocated: number; shortage: number }>();
        for (const row of itemBreakdown) {
            if (row.shortage_qty <= 0) continue;
            const prev = backorderByProduct.get(row.product_id) || {
                product_id: row.product_id,
                ordered: 0,
                allocated: 0,
                shortage: 0
            };
            prev.ordered += Number(row.ordered_qty || 0);
            prev.allocated += Number(row.allocated_qty || 0);
            prev.shortage += Number(row.shortage_qty || 0);
            backorderByProduct.set(row.product_id, prev);
        }
        const backorderItems = Array.from(backorderByProduct.values());

        // Backorder stays in the same order (no child order creation).

        // --- Auto-transition order status based on allocation progress ---
        let previousStatusForNotification: string | null = null;

        if (fullyAllocated || partiallyAllocated) {
            const statusProgressRank: Record<string, number> = {
                pending: 1,
                allocated: 1,
                partially_fulfilled: 1,
                debt_pending: 1,
                hold: 1,
                waiting_invoice: 2,
                ready_to_ship: 4,
                shipped: 5,
                delivered: 6,
                completed: 7,
                canceled: 7,
                expired: 7,
            };
            const previousOrderStatus = String(order.status || '');
            const currentRank = Number(statusProgressRank[order.status] || 0);
            const waitingInvoiceRank = Number(statusProgressRank.waiting_invoice);
            const nextStatus = currentRank >= waitingInvoiceRank ? order.status : 'waiting_invoice';

            if (nextStatus !== order.status) {
                await order.update({ status: nextStatus }, { transaction: t });
            }
            previousStatusForNotification = previousOrderStatus;
        }

        // --- Manage Backorders & Order Issues ---
        const now = new Date();

        // 1. Update Backorder Records on parent order items.
        // If order was split, parent item shortage is moved to child and parent becomes fulfilled.
        for (const row of itemBreakdown) {
            const shortage = Number(row.shortage_qty || 0);

            const [backorder, created] = await Backorder.findOrCreate({
                where: { order_item_id: row.oi.id },
                defaults: {
                    order_item_id: row.oi.id,
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

        // DEPRECATED: Shortage directly creates Backorder items (waiting_stock). 
        // We no longer create an 'OrderIssue' for shortage during allocation. 
        // Issues are only for "Missing Item" complaints after delivery.

        // Logic removed.

        // Resolve open shortage issues only when shortage no longer remains on current order.
        if (backorderItems.length === 0) {
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
        const previousStatus = String(previousStatusForNotification || '');
        const nextStatus = String(order.status || '');
        if (previousStatus && nextStatus && previousStatus !== nextStatus) {
            emitOrderStatusChanged({
                order_id: order.id,
                from_status: previousStatus,
                to_status: nextStatus,
                source: String(order.source || ''),
                payment_method: String(order.payment_method || ''),
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || ''),
                target_roles: nextStatus === 'waiting_invoice'
                    ? ['kasir', 'super_admin']
                    : ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            });
        } else {
            emitAdminRefreshBadges();
        }

        res.json({
            message: 'Alokasi berhasil',
            status: fullyAllocated
                ? 'fully_allocated'
                : (partiallyAllocated ? 'partially_allocated' : 'backorder_pending'),
            allocated_total: allocatedTotal,
            backorder_order_id: null,
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
        const previousOrderStatus = String(order.status || '');

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

        const allocatedByProduct = new Map<string, number>();
        for (const allocation of allocations) {
            const productId = String((allocation as any).product_id || '');
            if (!productId) continue;
            const prev = Number(allocatedByProduct.get(productId) || 0);
            allocatedByProduct.set(productId, prev + Number((allocation as any).allocated_qty || 0));
        }

        const remainingAllocatedByProduct = new Map<string, number>(allocatedByProduct);
        const itemBreakdown = orderItems.map((oi: any) => {
            const productId = String(oi.product_id || '');
            const orderedQty = Number(oi.qty || 0);
            const remainingAllocated = Number(remainingAllocatedByProduct.get(productId) || 0);
            const allocatedQty = Math.min(orderedQty, Math.max(0, remainingAllocated));
            const shortageQty = Math.max(0, orderedQty - allocatedQty);
            remainingAllocatedByProduct.set(productId, Math.max(0, remainingAllocated - allocatedQty));
            return {
                oi,
                product_id: productId,
                ordered_qty: orderedQty,
                allocated_qty: allocatedQty,
                shortage_qty: shortageQty
            };
        });

        // --- Cancel shortage only (do not cancel entire order) ---
        let originalSubtotal = 0;
        let remainingSubtotal = 0;

        for (const row of itemBreakdown) {
            const price = Number(row.oi.price_at_purchase || 0);
            originalSubtotal += price * Number(row.ordered_qty || 0);
            remainingSubtotal += price * Number(row.allocated_qty || 0);

            if (row.shortage_qty > 0) {
                await row.oi.update({ qty: row.allocated_qty }, { transaction: t });
            }

            const backorder = await Backorder.findOne({
                where: { order_item_id: row.oi.id },
                transaction: t
            });
            if (backorder && row.shortage_qty > 0) {
                await backorder.update({
                    qty_pending: 0,
                    status: 'canceled',
                    notes: `Reason: ${reason}`
                }, { transaction: t });
            } else if (backorder && row.shortage_qty <= 0 && backorder.status === 'waiting_stock') {
                await backorder.update({
                    qty_pending: 0,
                    status: 'fulfilled'
                }, { transaction: t });
            }
        }

        const shippingFee = Number(order.shipping_fee || 0);
        const currentDiscount = Number(order.discount_amount || 0);
        const discountRatio = originalSubtotal > 0 ? Math.min(1, Math.max(0, remainingSubtotal / originalSubtotal)) : 0;
        const nextDiscount = Math.round(currentDiscount * discountRatio * 100) / 100;
        const nextTotal = Math.max(0, Math.round((remainingSubtotal + shippingFee - nextDiscount) * 100) / 100);

        const nextStatus = remainingSubtotal <= 0
            ? 'canceled'
            : (order.status === 'hold' ? 'waiting_invoice' : order.status);

        await order.update({
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            status: nextStatus,
            stock_released: remainingSubtotal <= 0 ? true : order.stock_released
        }, { transaction: t });

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

        await t.commit();
        const finalStatus = String(nextStatus || order.status || '');
        if (previousOrderStatus !== finalStatus) {
            emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: previousOrderStatus || null,
                to_status: finalStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || ''),
                target_roles: ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            });
        } else {
            emitAdminRefreshBadges();
        }

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
