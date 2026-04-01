import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findInvoicesByOrderId } from '../../utils/invoiceLookup';
import { recordOrderEvent } from '../../utils/orderEvent';
import { buildShortageSummary, isAllocationEditableStatus, isReallocatableStatus, TERMINAL_ORDER_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { InventoryReservationService } from '../../services/InventoryReservationService';

const BACKORDER_FILL_GRACE_MS = 24 * 60 * 60 * 1000;

const safeLower = (v: unknown) => String(v || '').trim().toLowerCase();

const round2 = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toSnapshot = (raw: unknown): Record<string, unknown> | null => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, unknown>;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const embeddedDiscountForQty = (orderItem: any, qtyRaw: unknown): number => {
    const qty = Math.max(0, Math.trunc(Number(qtyRaw || 0)));
    if (qty <= 0) return 0;
    const unitPrice = Number(orderItem?.price_at_purchase || 0);
    const snapshot = toSnapshot(orderItem?.pricing_snapshot);
    const basePrice = snapshot ? Number(snapshot['base_price']) : Number.NaN;
    const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : unitPrice;
    return round2(Math.max(0, safeBase - unitPrice) * qty);
};

const isInvoiceShipmentPassedWarehouse = (shipmentStatusRaw: unknown): boolean => {
    const shipmentStatus = safeLower(shipmentStatusRaw);
    return shipmentStatus === 'shipped' || shipmentStatus === 'delivered' || shipmentStatus === 'canceled';
};

const findBlockingUnshippedInvoiceForBackorderFill = (invoicesRaw: any[], nowMs: number) => {
    const invoices = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    const candidates = invoices
        .filter((inv: any) => inv && !isInvoiceShipmentPassedWarehouse(inv?.shipment_status))
        .map((inv: any) => {
            const createdAt = inv?.createdAt ? new Date(inv.createdAt) : null;
            const createdAtMs = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : 0;
            return { inv, createdAtMs };
        })
        .filter((row: any) => row.createdAtMs > 0)
        .sort((a: any, b: any) => a.createdAtMs - b.createdAtMs);

    if (candidates.length === 0) return null;

    const oldest = candidates[0];
    const ageMs = nowMs - oldest.createdAtMs;
    if (ageMs <= BACKORDER_FILL_GRACE_MS) return null;
    return oldest.inv;
};

const distributeAllocationByItem = (items: any[], allocatedByProduct: Map<string, number>) => {
    const byProduct = new Map<string, any[]>();
    items.forEach((item: any) => {
        const productId = String(item?.product_id || '').trim();
        if (!productId) return;
        const rows = byProduct.get(productId) || [];
        rows.push(item);
        byProduct.set(productId, rows);
    });

    const result = new Map<string, { ordered_qty: number; allocated_qty: number; shortage_qty: number }>();
    byProduct.forEach((rows, productId) => {
        let remaining = Number(allocatedByProduct.get(productId) || 0);
        const sortedRows = [...rows].sort((a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')));
        sortedRows.forEach((row: any) => {
            const rowId = String(row?.id || '').trim();
            if (!rowId) return;
            const orderedQty = Math.max(0, Number(row?.ordered_qty_original || row?.qty || 0));
            const allocatedQty = Math.max(0, Math.min(remaining, orderedQty));
            remaining = Math.max(0, remaining - allocatedQty);
            result.set(rowId, {
                ordered_qty: orderedQty,
                allocated_qty: allocatedQty,
                shortage_qty: Math.max(0, orderedQty - allocatedQty),
            });
        });
    });
    return result;
};

export const allocateOrder = asyncWrapper(async (req: Request, res: Response) => {
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
            throw new CustomError('Order not found', 404);
        }

        const activeBackorderRows = await Backorder.findAll({
            include: [{
                model: OrderItem,
                required: true,
                where: { order_id: id }
            }],
            where: {
                qty_pending: { [Op.gt]: 0 },
                status: { [Op.notIn]: ['fulfilled', 'canceled'] }
            },
            attributes: ['id'],
            transaction: t
        });
        const allowCompletedBackorderRecovery =
            String(order.status || '').trim().toLowerCase() === 'completed' && activeBackorderRows.length > 0;
        const allowReadyToShipBackorderTopUp =
            safeLower(order.status) === 'ready_to_ship' && activeBackorderRows.length > 0;

        if (!isReallocatableStatus(order.status) && !allowCompletedBackorderRecovery && !allowReadyToShipBackorderTopUp) {
            await t.rollback();
            throw new CustomError(`Order dengan status '${order.status}' tidak bisa dialokasikan`, 400);
        }
        if (!isAllocationEditableStatus(order.status) && !allowCompletedBackorderRecovery && !allowReadyToShipBackorderTopUp) {
            await t.rollback();
            throw new CustomError(`Alokasi dikunci karena order sudah masuk proses finance/pengiriman (status: '${order.status}').`, 400);
        }

        // Backorder fill policy: do not allow filling/allocating additional backorder qty while an earlier
        // invoice for THIS order has not passed warehouse/shipping yet (except within a short grace window,
        // so same-day restock can complete the shortage before warehouse ships).
        if (activeBackorderRows.length > 0) {
            const invoices = await findInvoicesByOrderId(String(order.id), { transaction: t });
            const blockingInvoice = findBlockingUnshippedInvoiceForBackorderFill(invoices as any[], Date.now());
            if (blockingInvoice) {
                await t.rollback();
                throw new CustomError(
                    `Tidak bisa mengisi/alokasikan backorder untuk order ini karena masih ada invoice yang belum melewati proses gudang (Invoice ${String(blockingInvoice.invoice_number || blockingInvoice.id)} shipment_status '${String(blockingInvoice.shipment_status)}').`,
                    409
                );
            }
        }

        const incomingItems = Array.isArray(items) ? items : [];
        if (incomingItems.length === 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi', 400);
        }

        const requestedQtyByProduct = new Map<string, number>();
        for (const rawItem of incomingItems) {
            const productId = String(rawItem?.product_id || '').trim();
            if (!productId) {
                await t.rollback();
                throw new CustomError('product_id wajib diisi', 400);
            }
            const parsedQty = Number(rawItem?.qty);
            if (!Number.isFinite(parsedQty) || parsedQty < 0) {
                await t.rollback();
                throw new CustomError(`Qty alokasi untuk produk ${productId} tidak valid`, 400);
            }
            requestedQtyByProduct.set(productId, Math.trunc(parsedQty));
        }

        const requestedProductIds = Array.from(requestedQtyByProduct.keys());
        if (requestedProductIds.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item alokasi yang valid', 400);
        }

        const orderItemsForValidation = await OrderItem.findAll({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const orderItemIdsForValidation = (orderItemsForValidation as any[])
            .map((row: any) => String(row?.id || '').trim())
            .filter(Boolean);
        const priorInvoiceItemsForValidation = orderItemIdsForValidation.length > 0
            ? await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIdsForValidation } },
                attributes: ['order_item_id', 'qty'],
                transaction: t,
                lock: t.LOCK.SHARE
            })
            : [];
        const invoicedQtyByOrderItemIdForValidation = new Map<string, number>();
        priorInvoiceItemsForValidation.forEach((item: any) => {
            const key = String(item?.order_item_id || '').trim();
            if (!key) return;
            const prev = Number(invoicedQtyByOrderItemIdForValidation.get(key) || 0);
            invoicedQtyByOrderItemIdForValidation.set(key, prev + Math.max(0, Number(item?.qty || 0)));
        });

        const totalOrderedByProduct = new Map<string, number>();
        const remainingDemandByProduct = new Map<string, number>();
        for (const row of orderItemsForValidation as any[]) {
            const productId = String(row?.product_id || '').trim();
            if (!productId) continue;
            const orderedOriginal = Math.max(0, Math.trunc(Number(row?.ordered_qty_original ?? row?.qty ?? 0)));
            const canceledBackorder = Math.max(0, Math.trunc(Number(row?.qty_canceled_backorder || 0)));
            const canceledManual = Math.max(0, Math.trunc(Number(row?.qty_canceled_manual || 0)));
            const invoiced = Math.max(0, Math.trunc(Number(invoicedQtyByOrderItemIdForValidation.get(String(row?.id || '')) || 0)));
            const remaining = Math.max(0, orderedOriginal - canceledBackorder - canceledManual - invoiced);

            totalOrderedByProduct.set(productId, Number(totalOrderedByProduct.get(productId) || 0) + orderedOriginal);
            remainingDemandByProduct.set(productId, Number(remainingDemandByProduct.get(productId) || 0) + remaining);
        }

        for (const productId of requestedProductIds) {
            const orderedQty = Number(totalOrderedByProduct.get(productId) || 0);
            const requestedQty = Number(requestedQtyByProduct.get(productId) || 0);
            if (orderedQty <= 0) {
                await t.rollback();
                throw new CustomError(`Produk ${productId} tidak ada pada order ini`, 400);
            }
            const remainingQty = Number(remainingDemandByProduct.get(productId) || 0);
            if (requestedQty > remainingQty) {
                await t.rollback();
                throw new CustomError(
                    `Qty alokasi untuk produk ${productId} melebihi qty sisa (requested ${requestedQty}, remaining ${remainingQty}, ordered ${orderedQty}).`,
                    409
                );
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
            throw new CustomError(`Produk tidak ditemukan: ${missingProductIds.join(', ')}`, 404);
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
        const beforeAllocatedByProduct = new Map<string, number>();
        existingAllocations.forEach((allocation: any) => {
            const productId = String(allocation?.product_id || '').trim();
            if (!productId) return;
            const prev = Number(beforeAllocatedByProduct.get(productId) || 0);
            beforeAllocatedByProduct.set(productId, prev + Number(allocation?.allocated_qty || 0));
        });
        const beforeItemAllocation = distributeAllocationByItem(
            orderItemsForValidation.map((row: any) => row.get({ plain: true })),
            beforeAllocatedByProduct
        );

        for (const productId of requestedProductIds) {
            const product = productById.get(productId);
            const rows = allocationsByProduct.get(productId) || [];
            const requestedQty = Number(requestedQtyByProduct.get(productId) || 0);
            const previouslyAllocatedTotal = rows.reduce((sum, row) => sum + Number(row?.allocated_qty || 0), 0);
            const currentStockQty = Number(product?.stock_quantity || 0);
            const maxAllocatableQty = previouslyAllocatedTotal + Math.max(0, currentStockQty);

            if (requestedQty > maxAllocatableQty) {
                await t.rollback();
                throw new CustomError(`Stok tidak cukup untuk ${product?.name || productId}. Sisa stok: ${Math.max(0, currentStockQty)}, maksimal alokasi saat ini: ${maxAllocatableQty}`, 400);
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
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

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
                // Keep ready_to_ship as-is; extra allocation can be billed via issueInvoiceByItems without
                // downgrading the warehouse queue status.
                nextStatus = safeLower(previousOrderStatus) === 'ready_to_ship'
                    ? previousOrderStatus
                    : 'waiting_invoice';
            } else {
                const currentRank = Number(statusProgressRank[previousOrderStatus] || 0);
                const waitingInvoiceRank = Number(statusProgressRank.waiting_invoice);
                nextStatus = currentRank >= waitingInvoiceRank ? previousOrderStatus : 'waiting_invoice';
            }

            if (nextStatus !== previousOrderStatus) {
                if (!isOrderTransitionAllowed(previousOrderStatus, nextStatus)) {
                    await t.rollback();
                    throw new CustomError(`Transisi status tidak diizinkan: '${previousOrderStatus}' -> '${nextStatus}'`, 409);
                }
                await order.update({ status: nextStatus as any }, { transaction: t });
                await recordOrderEvent({
                    transaction: t,
                    order_id: String(id),
                    event_type: 'order_status_changed',
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    payload: {
                        before: { status: previousOrderStatus },
                        after: { status: nextStatus },
                        delta: { status_changed: true }
                    }
                });
            }
            previousStatusForNotification = previousOrderStatus;
        }

        // --- Manage Backorders & Order Issues ---
        const now = new Date();

        // 1. Update Backorder Records on parent order items.
        // If order was split, parent item shortage is moved to child and parent becomes fulfilled.
        for (const row of itemBreakdown) {
            const shortage = Number(row.shortage_qty || 0);
            const orderItemId = String(row?.oi?.id || '');
            const beforeItem = beforeItemAllocation.get(orderItemId) || {
                ordered_qty: Number(row.ordered_qty || 0),
                allocated_qty: 0,
                shortage_qty: Number(row.ordered_qty || 0),
            };

            if (Number(beforeItem.allocated_qty || 0) !== Number(row.allocated_qty || 0)) {
                await recordOrderEvent({
                    transaction: t,
                    order_id: String(id),
                    order_item_id: orderItemId,
                    event_type: 'allocation_set',
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    payload: {
                        before: {
                            allocated_qty: Number(beforeItem.allocated_qty || 0),
                            shortage_qty: Number(beforeItem.shortage_qty || 0),
                        },
                        after: {
                            allocated_qty: Number(row.allocated_qty || 0),
                            shortage_qty: Number(row.shortage_qty || 0),
                        },
                        delta: {
                            allocated_qty: Number(row.allocated_qty || 0) - Number(beforeItem.allocated_qty || 0),
                            shortage_qty: Number(row.shortage_qty || 0) - Number(beforeItem.shortage_qty || 0),
                        }
                    }
                });
            }

            if (Number(beforeItem.shortage_qty || 0) !== Number(row.shortage_qty || 0)) {
                const eventType = Number(row.shortage_qty || 0) > Number(beforeItem.shortage_qty || 0)
                    ? 'backorder_opened'
                    : 'backorder_reallocated';
                await recordOrderEvent({
                    transaction: t,
                    order_id: String(id),
                    order_item_id: orderItemId,
                    event_type: eventType,
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    payload: {
                        before: { shortage_qty: Number(beforeItem.shortage_qty || 0) },
                        after: { shortage_qty: Number(row.shortage_qty || 0) },
                        delta: { shortage_qty: Number(row.shortage_qty || 0) - Number(beforeItem.shortage_qty || 0) }
                    }
                });
            }

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

        await InventoryReservationService.syncReservationsForOrder({ order_id: String(id), transaction: t });

        const previousStatus = String(previousStatusForNotification || '');
        const nextStatus = String(order.status || '');
        if (previousStatus && nextStatus && previousStatus !== nextStatus) {
            await emitOrderStatusChanged({
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
            }, {
                transaction: t,
                requestContext: 'allocation_status_changed'
            });
        } else {
            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'allocation_refresh_badges'
            });
        }

        await t.commit();

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
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const cancelBackorder = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const reason = reasonRaw.trim();

        if (!reason) {
            await t.rollback();
            throw new CustomError('Alasan cancel wajib diisi.', 400);
        }

        const order = await Order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan.', 404);
        }
        const previousOrderStatus = String(order.status || '');
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(String(order.status || '').trim().toLowerCase())) {
            await t.rollback();
            throw new CustomError(`Order dengan status '${order.status}' tidak bisa cancel backorder.`, 400);
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
            throw new CustomError('Order ini tidak memiliki kekurangan alokasi (bukan backorder/pre-order).', 400);
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
                await row.oi.update({
                    qty: row.allocated_qty,
                    qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0) + Number(row.shortage_qty || 0),
                }, { transaction: t });

                await recordOrderEvent({
                    transaction: t,
                    order_id: String(id),
                    order_item_id: String(row?.oi?.id || ''),
                    event_type: 'backorder_canceled',
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    reason,
                    payload: {
                        before: {
                            shortage_qty: Number(row.shortage_qty || 0),
                            qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0),
                        },
                        after: {
                            shortage_qty: 0,
                            qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0) + Number(row.shortage_qty || 0),
                        },
                        delta: {
                            canceled_qty: Number(row.shortage_qty || 0)
                        }
                    }
                });
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
        const embeddedOriginalDiscount = round2(itemBreakdown.reduce((sum, row) => sum + embeddedDiscountForQty(row.oi, row.ordered_qty), 0));
        const embeddedRemainingDiscount = round2(itemBreakdown.reduce((sum, row) => sum + embeddedDiscountForQty(row.oi, row.allocated_qty), 0));
        const externalDiscount = Math.max(0, round2(currentDiscount - embeddedOriginalDiscount));
        const discountRatio = originalSubtotal > 0 ? Math.min(1, Math.max(0, remainingSubtotal / originalSubtotal)) : 0;
        const externalDiscountNext = round2(externalDiscount * discountRatio);
        const nextDiscount = round2(embeddedRemainingDiscount + externalDiscountNext);
        const nextTotal = Math.max(0, round2(remainingSubtotal + shippingFee - externalDiscountNext));

        const [orderWithInvoice] = await attachInvoicesToOrders([order], { transaction: t });
        const attachedInvoice = orderWithInvoice?.Invoice || null;
        const attachedPaymentMethod = String(attachedInvoice?.payment_method || order.payment_method || '').trim().toLowerCase();
        const attachedPaymentStatus = String(attachedInvoice?.payment_status || '').trim().toLowerCase();
        const paymentSettled =
            attachedPaymentStatus === 'paid'
            || (attachedPaymentMethod === 'cod' && attachedPaymentStatus === 'cod_pending');

        const openBackorderCount = await Backorder.count({
            where: {
                order_item_id: { [Op.in]: orderItems.map((row: any) => row.id) },
                qty_pending: { [Op.gt]: 0 },
                status: 'waiting_stock'
            },
            transaction: t
        });

        let nextStatus = remainingSubtotal <= 0
            ? 'canceled'
            : (order.status === 'hold' ? 'waiting_invoice' : order.status);

        if (remainingSubtotal > 0 && openBackorderCount === 0) {
            const currentStatus = String(order.status || '').trim().toLowerCase();
            if (currentStatus === 'partially_fulfilled') {
                nextStatus = paymentSettled ? 'completed' : 'delivered';
            }
        }

        await order.update({
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            status: nextStatus,
            stock_released: remainingSubtotal <= 0 ? true : order.stock_released
        }, { transaction: t });
        if (previousOrderStatus !== nextStatus) {
            await recordOrderEvent({
                transaction: t,
                order_id: String(id),
                event_type: 'order_status_changed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: { status: previousOrderStatus },
                    after: { status: nextStatus },
                    delta: { status_changed: true }
                }
            });
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

        const finalStatus = String(nextStatus || order.status || '');
        if (previousOrderStatus !== finalStatus) {
            await emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: previousOrderStatus || null,
                to_status: finalStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || ''),
                target_roles: ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            }, {
                transaction: t,
                requestContext: 'allocation_cancel_backorder_status_changed'
            });
        } else {
            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'allocation_cancel_backorder_refresh_badges'
            });
        }

        await t.commit();

        return res.json({
            message: 'Backorder / pre-order berhasil dibatalkan.',
            order_id: id,
            canceled_reason: reason,
            shortage_items: shortageItems,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const cancelBackorderItems = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason : '';
        const reason = reasonRaw.trim();
        const productIdsRaw = Array.isArray(req.body?.product_ids) ? req.body.product_ids : [];
        const productIds = productIdsRaw
            .map((value: unknown) => String(value || '').trim())
            .filter(Boolean);

        if (!reason) {
            await t.rollback();
            throw new CustomError('Alasan cancel wajib diisi.', 400);
        }
        if (productIds.length === 0) {
            await t.rollback();
            throw new CustomError('product_ids wajib diisi.', 400);
        }

        const order = await Order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan.', 404);
        }
        const previousOrderStatus = String(order.status || '');
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(String(order.status || '').trim().toLowerCase())) {
            await t.rollback();
            throw new CustomError(`Order dengan status '${order.status}' tidak bisa cancel backorder.`, 400);
        }

        const targetProductIds = new Set<string>(productIds);

        const orderItems = await OrderItem.findAll({
            where: { order_id: id },
            include: [{ model: Product, attributes: ['id', 'name'], required: false }],
            transaction: t,
            lock: t.LOCK.UPDATE,
            order: [['id', 'ASC']]
        });
        const allocations = await OrderAllocation.findAll({
            where: { order_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const { shortageItems } = buildShortageSummary(
            orderItems.map((item: any) => item.get({ plain: true })),
            allocations.map((allocation: any) => allocation.get({ plain: true }))
        );

        if (shortageItems.length === 0) {
            await t.rollback();
            throw new CustomError('Order ini tidak memiliki kekurangan alokasi (bukan backorder/pre-order).', 400);
        }

        const effectiveShortageTargets = (shortageItems as any[]).filter((row: any) => targetProductIds.has(String(row?.product_id || '')));
        if (effectiveShortageTargets.length === 0) {
            await t.rollback();
            throw new CustomError('SKU yang dipilih tidak memiliki backorder aktif.', 409);
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

        let originalSubtotal = 0;
        let remainingSubtotal = 0;
        let didCancelAny = false;

        for (const row of itemBreakdown) {
            const price = Number(row.oi.price_at_purchase || 0);
            originalSubtotal += price * Number(row.ordered_qty || 0);

            const shouldCancel = targetProductIds.has(String(row.product_id || '')) && row.shortage_qty > 0;
            remainingSubtotal += price * Number(shouldCancel ? row.allocated_qty : row.ordered_qty);

            if (!shouldCancel) {
                const backorder = await Backorder.findOne({
                    where: { order_item_id: row.oi.id },
                    transaction: t
                });
                if (backorder && row.shortage_qty <= 0 && backorder.status === 'waiting_stock') {
                    await backorder.update({
                        qty_pending: 0,
                        status: 'fulfilled'
                    }, { transaction: t });
                }
                continue;
            }

            didCancelAny = true;
            await row.oi.update({
                qty: row.allocated_qty,
                qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0) + Number(row.shortage_qty || 0),
            }, { transaction: t });

            await recordOrderEvent({
                transaction: t,
                order_id: String(id),
                order_item_id: String(row?.oi?.id || ''),
                event_type: 'backorder_canceled',
                actor_user_id: actorId,
                actor_role: actorRole,
                reason,
                payload: {
                    before: {
                        shortage_qty: Number(row.shortage_qty || 0),
                        qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0),
                    },
                    after: {
                        shortage_qty: 0,
                        qty_canceled_backorder: Number(row.oi.qty_canceled_backorder || 0) + Number(row.shortage_qty || 0),
                    },
                    delta: {
                        canceled_qty: Number(row.shortage_qty || 0)
                    }
                }
            });

            const backorder = await Backorder.findOne({
                where: { order_item_id: row.oi.id },
                transaction: t
            });
            if (backorder) {
                await backorder.update({
                    qty_pending: 0,
                    status: 'canceled',
                    notes: `Reason: ${reason}`
                }, { transaction: t });
            }
        }

        if (!didCancelAny) {
            await t.rollback();
            throw new CustomError('Tidak ada qty backorder yang bisa dibatalkan untuk SKU ini.', 409);
        }

        const shippingFee = Number(order.shipping_fee || 0);
        const currentDiscount = Number(order.discount_amount || 0);
        const embeddedOriginalDiscount = round2(itemBreakdown.reduce((sum, row) => sum + embeddedDiscountForQty(row.oi, row.ordered_qty), 0));
        const embeddedRemainingDiscount = round2(itemBreakdown.reduce((sum, row) => {
            const shouldCancel = targetProductIds.has(String(row.product_id || '')) && row.shortage_qty > 0;
            const qty = shouldCancel ? row.allocated_qty : row.ordered_qty;
            return sum + embeddedDiscountForQty(row.oi, qty);
        }, 0));
        const externalDiscount = Math.max(0, round2(currentDiscount - embeddedOriginalDiscount));
        const discountRatio = originalSubtotal > 0 ? Math.min(1, Math.max(0, remainingSubtotal / originalSubtotal)) : 0;
        const externalDiscountNext = round2(externalDiscount * discountRatio);
        const nextDiscount = round2(embeddedRemainingDiscount + externalDiscountNext);
        const nextTotal = Math.max(0, round2(remainingSubtotal + shippingFee - externalDiscountNext));

        const [orderWithInvoice] = await attachInvoicesToOrders([order], { transaction: t });
        const attachedInvoice = orderWithInvoice?.Invoice || null;
        const attachedPaymentMethod = String(attachedInvoice?.payment_method || order.payment_method || '').trim().toLowerCase();
        const attachedPaymentStatus = String(attachedInvoice?.payment_status || '').trim().toLowerCase();
        const paymentSettled =
            attachedPaymentStatus === 'paid'
            || (attachedPaymentMethod === 'cod' && attachedPaymentStatus === 'cod_pending');

        const openBackorderCount = await Backorder.count({
            where: {
                order_item_id: { [Op.in]: orderItems.map((row: any) => row.id) },
                qty_pending: { [Op.gt]: 0 },
                status: 'waiting_stock'
            },
            transaction: t
        });

        let nextStatus = remainingSubtotal <= 0
            ? 'canceled'
            : (order.status === 'hold' ? 'waiting_invoice' : order.status);

        if (remainingSubtotal > 0 && openBackorderCount === 0) {
            const currentStatus = String(order.status || '').trim().toLowerCase();
            if (currentStatus === 'partially_fulfilled') {
                nextStatus = paymentSettled ? 'completed' : 'delivered';
            }
        }

        await order.update({
            total_amount: nextTotal,
            discount_amount: nextDiscount,
            status: nextStatus,
            stock_released: remainingSubtotal <= 0 ? true : order.stock_released
        }, { transaction: t });
        if (previousOrderStatus !== nextStatus) {
            await recordOrderEvent({
                transaction: t,
                order_id: String(id),
                event_type: 'order_status_changed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: { status: previousOrderStatus },
                    after: { status: nextStatus },
                    delta: { status_changed: true }
                }
            });
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
            note: `[CANCEL_BACKORDER_ITEMS] ${reason}`,
            due_at: now,
            resolved_at: now,
            created_by: req.user?.id || null,
            resolved_by: req.user?.id || null,
        }, { transaction: t });

        const finalStatus = String(nextStatus || order.status || '');
        if (previousOrderStatus !== finalStatus) {
            await emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: previousOrderStatus || null,
                to_status: finalStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || ''),
                target_roles: ['kasir', 'admin_gudang', 'admin_finance', 'customer'],
            }, {
                transaction: t,
                requestContext: 'allocation_cancel_backorder_items_status_changed'
            });
        } else {
            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'allocation_cancel_backorder_items_refresh_badges'
            });
        }

        await t.commit();

        return res.json({
            message: 'Backorder SKU berhasil dibatalkan.',
            order_id: id,
            canceled_reason: reason,
            canceled_product_ids: Array.from(targetProductIds),
            shortage_items: effectiveShortageTargets,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
