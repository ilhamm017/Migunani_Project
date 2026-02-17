import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, Invoice, OrderIssue, Backorder } from '../models';
import { generateInvoiceNumber, resolveInitialInvoiceStatus } from '../utils/invoice';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';


const REALLOCATABLE_STATUSES = ['pending', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'] as const;
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
                    is_backorder: (needsAllocation && allocatedTotal > 0) || !!plain.parent_order_id,
                    status_label: !needsAllocation ? 'fulfilled' : (plain.parent_order_id ? 'backorder' : (allocatedTotal > 0 ? 'backorder' : 'preorder')),
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

        // Split only when some qty can be processed now and some must become backorder.
        const shouldSplitOrder = backorderItems.length > 0 && partiallyAllocated;
        let childOrderId: string | null = null;

        if (shouldSplitOrder) {
            const childOrder = await Order.create({
                customer_id: order.customer_id,
                customer_name: order.customer_name,
                source: order.source,
                status: 'pending',
                total_amount: 0,
                discount_amount: 0,
                parent_order_id: order.id,
                stock_released: false
            }, { transaction: t });
            childOrderId = childOrder.id;

            const parentInvoice = await Invoice.findOne({
                where: { order_id: id },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (parentInvoice) {
                const childInvoiceNumber = generateInvoiceNumber(childOrder.id);
                const initialStatus = await resolveInitialInvoiceStatus();

                await Invoice.create({
                    order_id: childOrder.id,
                    invoice_number: childInvoiceNumber,
                    payment_method: parentInvoice.payment_method,
                    payment_status: initialStatus,
                    amount_paid: 0,
                    change_amount: 0,
                    subtotal: 0,
                    tax_percent: 0,
                    tax_amount: 0,
                    total: 0,
                    tax_mode_snapshot: parentInvoice.tax_mode_snapshot || 'non_pkp',
                    pph_final_amount: parentInvoice.pph_final_amount || 0
                }, { transaction: t });
            }

            let childTotal = 0;
            for (const row of itemBreakdown) {
                if (row.shortage_qty <= 0) continue;

                const childItem = await OrderItem.create({
                    order_id: childOrderId as string,
                    product_id: row.oi.product_id,
                    qty: row.shortage_qty,
                    price_at_purchase: row.oi.price_at_purchase,
                    cost_at_purchase: row.oi.cost_at_purchase
                }, { transaction: t });

                childTotal += Number(row.oi.price_at_purchase || 0) * Number(row.shortage_qty || 0);

                await Backorder.findOrCreate({
                    where: { order_item_id: childItem.id },
                    defaults: {
                        order_item_id: childItem.id,
                        qty_pending: row.shortage_qty,
                        status: 'waiting_stock'
                    },
                    transaction: t
                });

                await row.oi.update({ qty: row.allocated_qty }, { transaction: t });
            }

            await childOrder.update({ total_amount: childTotal }, { transaction: t });
            await Invoice.update({
                subtotal: childTotal,
                total: childTotal
            }, {
                where: { order_id: childOrder.id },
                transaction: t
            });
        }

        await order.update({ total_amount: allocatedTotal }, { transaction: t });

        // --- Auto-transition order & invoice status based on payment method ---
        const invoice = await Invoice.findOne({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        let previousStatusForNotification: string | null = null;

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
            const previousOrderStatus = String(order.status || '');
            const currentRank = Number(statusProgressRank[order.status] || 0);
            const waitingInvoiceRank = Number(statusProgressRank.waiting_invoice);
            const nextStatus = currentRank >= waitingInvoiceRank ? order.status : 'waiting_invoice';

            if (nextStatus !== order.status) {
                await order.update({ status: nextStatus }, { transaction: t });
            }
            previousStatusForNotification = previousOrderStatus;

            if (invoice) {
                // Keep invoice in draft — Finance will issue it
            }
        }

        // --- Manage Backorders & Order Issues ---
        const now = new Date();

        // 1. Update Backorder Records on parent order items.
        // If order was split, parent item shortage is moved to child and parent becomes fulfilled.
        for (const row of itemBreakdown) {
            const shortage = shouldSplitOrder ? 0 : Number(row.shortage_qty || 0);

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
        if (backorderItems.length === 0 || shouldSplitOrder) {
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
                payment_method: String(invoice?.payment_method || ''),
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || ''),
                target_roles: nextStatus === 'waiting_invoice'
                    ? ['admin_finance']
                    : ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            });
        } else {
            emitAdminRefreshBadges();
        }

        res.json({
            message: 'Alokasi berhasil',
            status: fullyAllocated
                ? 'fully_allocated'
                : (shouldSplitOrder ? 'partially_allocated_with_split' : (partiallyAllocated ? 'partially_allocated' : 'backorder_pending')),
            allocated_total: allocatedTotal,
            backorder_order_id: childOrderId,
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
        if (previousOrderStatus !== 'canceled') {
            emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: previousOrderStatus || null,
                to_status: 'canceled',
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
