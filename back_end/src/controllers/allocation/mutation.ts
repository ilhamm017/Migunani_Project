import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
import { buildShortageSummary, ALLOCATION_EDITABLE_STATUSES, REALLOCATABLE_STATUSES } from './utils';

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

        const incomingItems = Array.isArray(items) ? items : [];
        if (incomingItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'items wajib diisi' });
        }

        const requestedQtyByProduct = new Map<string, number>();
        for (const rawItem of incomingItems) {
            const productId = String(rawItem?.product_id || '').trim();
            if (!productId) {
                await t.rollback();
                return res.status(400).json({ message: 'product_id wajib diisi' });
            }
            const parsedQty = Number(rawItem?.qty);
            if (!Number.isFinite(parsedQty) || parsedQty < 0) {
                await t.rollback();
                return res.status(400).json({ message: `Qty alokasi untuk produk ${productId} tidak valid` });
            }
            requestedQtyByProduct.set(productId, Math.trunc(parsedQty));
        }

        const requestedProductIds = Array.from(requestedQtyByProduct.keys());
        if (requestedProductIds.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item alokasi yang valid' });
        }

        const orderItemsForValidation = await OrderItem.findAll({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const orderedByProduct = new Map<string, number>();
        for (const row of orderItemsForValidation as any[]) {
            const productId = String(row?.product_id || '');
            if (!productId) continue;
            const prev = Number(orderedByProduct.get(productId) || 0);
            orderedByProduct.set(productId, prev + Number(row?.qty || 0));
        }

        for (const productId of requestedProductIds) {
            const orderedQty = Number(orderedByProduct.get(productId) || 0);
            const requestedQty = Number(requestedQtyByProduct.get(productId) || 0);
            if (orderedQty <= 0) {
                await t.rollback();
                return res.status(400).json({ message: `Produk ${productId} tidak ada pada order ini` });
            }
            if (requestedQty > orderedQty) {
                await t.rollback();
                return res.status(400).json({
                    message: `Qty alokasi untuk produk ${productId} melebihi qty order (${requestedQty}/${orderedQty})`
                });
            }
        }

        const products = await Product.findAll({
            where: { id: { [Op.in]: requestedProductIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const productById = new Map<string, any>();
        for (const product of products as any[]) {
            productById.set(String(product.id), product);
        }
        if (productById.size !== requestedProductIds.length) {
            const missingProductIds = requestedProductIds.filter((productId) => !productById.has(productId));
            await t.rollback();
            return res.status(404).json({ message: `Produk tidak ditemukan: ${missingProductIds.join(', ')}` });
        }

        const existingAllocations = await OrderAllocation.findAll({
            where: {
                order_id: id,
                product_id: { [Op.in]: requestedProductIds }
            },
            transaction: t,
            lock: t.LOCK.UPDATE,
            order: [['createdAt', 'ASC'], ['id', 'ASC']]
        });
        const allocationsByProduct = new Map<string, any[]>();
        for (const allocation of existingAllocations as any[]) {
            const productId = String(allocation?.product_id || '');
            if (!productId) continue;
            const rows = allocationsByProduct.get(productId) || [];
            rows.push(allocation);
            allocationsByProduct.set(productId, rows);
        }

        for (const productId of requestedProductIds) {
            const product = productById.get(productId);
            const rows = allocationsByProduct.get(productId) || [];
            const requestedQty = Number(requestedQtyByProduct.get(productId) || 0);
            const previouslyAllocatedTotal = rows.reduce((sum, row) => sum + Number(row?.allocated_qty || 0), 0);
            const currentStockQty = Number(product?.stock_quantity || 0);
            const maxAllocatableQty = previouslyAllocatedTotal + Math.max(0, currentStockQty);

            if (requestedQty > maxAllocatableQty) {
                await t.rollback();
                return res.status(400).json({
                    message: `Stok tidak cukup untuk ${product?.name || productId}. Sisa stok: ${Math.max(0, currentStockQty)}, maksimal alokasi saat ini: ${maxAllocatableQty}`
                });
            }

            const delta = requestedQty - previouslyAllocatedTotal;
            if (delta > 0) {
                await product.update({
                    stock_quantity: currentStockQty - delta,
                    allocated_quantity: Number(product?.allocated_quantity || 0) + delta,
                }, { transaction: t });
            } else if (delta < 0) {
                const absDelta = Math.abs(delta);
                await product.update({
                    stock_quantity: currentStockQty + absDelta,
                    allocated_quantity: Math.max(0, Number(product?.allocated_quantity || 0) - absDelta),
                }, { transaction: t });
            }

            if (rows.length === 0) {
                if (requestedQty > 0) {
                    await OrderAllocation.create({
                        order_id: id,
                        product_id: productId,
                        allocated_qty: requestedQty,
                        status: 'pending'
                    }, { transaction: t });
                }
                continue;
            }

            const [primaryAllocation, ...extraAllocations] = rows;
            await primaryAllocation.update({ allocated_qty: requestedQty }, { transaction: t });
            for (const extra of extraAllocations) {
                if (Number(extra?.allocated_qty || 0) === 0) continue;
                await extra.update({ allocated_qty: 0 }, { transaction: t });
            }
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

        const orderItemIds = itemBreakdown
            .map((row) => String(row?.oi?.id || ''))
            .filter(Boolean);
        const priorInvoiceItems = orderItemIds.length > 0
            ? await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIds } },
                transaction: t
            })
            : [];
        const invoicedQtyByOrderItemId = new Map<string, number>();
        priorInvoiceItems.forEach((item: any) => {
            const key = String(item?.order_item_id || '');
            if (!key) return;
            const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
            invoicedQtyByOrderItemId.set(key, prev + Number(item?.qty || 0));
        });
        const hasNewInvoiceableQty = itemBreakdown.some((row) => {
            const orderItemId = String(row?.oi?.id || '');
            if (!orderItemId) return false;
            const allocatedQty = Number(row?.allocated_qty || 0);
            const alreadyInvoiced = Number(invoicedQtyByOrderItemId.get(orderItemId) || 0);
            return allocatedQty > alreadyInvoiced;
        });

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
            let nextStatus = previousOrderStatus;
            if (hasNewInvoiceableQty) {
                nextStatus = 'waiting_invoice';
            } else {
                const currentRank = Number(statusProgressRank[previousOrderStatus] || 0);
                const waitingInvoiceRank = Number(statusProgressRank.waiting_invoice);
                nextStatus = currentRank >= waitingInvoiceRank ? previousOrderStatus : 'waiting_invoice';
            }

            if (nextStatus !== previousOrderStatus) {
                await order.update({ status: nextStatus as any }, { transaction: t });
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
