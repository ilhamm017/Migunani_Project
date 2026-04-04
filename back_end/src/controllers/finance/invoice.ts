import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting, Backorder } from '../../models';
import { Op } from 'sequelize';
import { JournalService } from '../../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../../utils/orderNotification';
import { generateInvoiceNumber } from '../../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { recordOrderEvent } from '../../utils/orderEvent';


import {
    toSafeText, normalizeExpenseDetails, parseExpenseNote, buildExpenseNote, ensureDefaultExpenseLabels,
    genCreditNoteNumber, normalizeTaxNumber, buildAccountsReceivableInclude, buildAccountsReceivableContext, mapAccountsReceivableRows,
} from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

const normalizeScopeList = (values: unknown[]): string =>
    Array.from(new Set(
        values
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )).sort().join(',');

const safeLower = (value: unknown): string => String(value || '').trim().toLowerCase();
const n = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number): number => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const toSnapshot = (raw: unknown): Record<string, unknown> | null => {
    if (!raw) return null;
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const embeddedDiscountForQty = (orderItem: any, qtyRaw: unknown): number => {
    const qty = Math.max(0, Math.trunc(n(qtyRaw)));
    if (qty <= 0) return 0;
    const unitPrice = n(orderItem?.price_at_purchase);
    const snapshot = toSnapshot(orderItem?.pricing_snapshot);
    const basePriceRaw = snapshot ? snapshot['base_price'] : null;
    const basePrice = Number(basePriceRaw);
    const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : unitPrice;
    return round2(Math.max(0, safeBase - unitPrice) * qty);
};

const buildIssueInvoiceScope = (userId: unknown, orderIds: unknown[]) =>
    `finance_issue_invoice:${String(userId || '').trim()}:${normalizeScopeList(orderIds)}`;

const buildIssueInvoiceItemsScope = (
    userId: unknown,
    items: Array<{ order_item_id: string; qty: number }>
) => {
    const normalized = items
        .map((item) => ({
            order_item_id: String(item?.order_item_id || '').trim(),
            qty: Number(item?.qty || 0)
        }))
        .filter((item) => item.order_item_id && Number.isFinite(item.qty) && item.qty > 0)
        .sort((a, b) => {
            if (a.order_item_id === b.order_item_id) return a.qty - b.qty;
            return a.order_item_id.localeCompare(b.order_item_id);
        })
        .map((item) => `${item.order_item_id}:${item.qty}`);
    return `finance_issue_invoice_items:${String(userId || '').trim()}:${normalized.join(',')}`;
};

const VALID_COMBINED_INVOICE_PAYMENT_METHODS = new Set([
    'transfer_manual',
    'cod',
    'cash_store'
]);

const normalizeCombinedInvoicePaymentMethod = (value: unknown): string => {
    const normalized = String(value || '').trim().toLowerCase();
    return VALID_COMBINED_INVOICE_PAYMENT_METHODS.has(normalized) ? normalized : '';
};

const resolveCombinedInvoicePaymentMethod = (orders: any[]): string => {
    const candidates = orders
        .map((order) => ({
            payment_method: normalizeCombinedInvoicePaymentMethod(order?.payment_method),
            updatedAt: new Date(order?.updatedAt || 0).getTime(),
            createdAt: new Date(order?.createdAt || 0).getTime()
        }))
        .filter((order) => Boolean(order.payment_method))
        .sort((a, b) => {
            if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
            return b.createdAt - a.createdAt;
        });

    return String(candidates[0]?.payment_method || '');
};

const syncCombinedInvoiceOrderPaymentMethod = async (
    orders: any[],
    paymentMethod: string,
    transaction: any
) => {
    const orderIdsToSync = orders
        .filter((order) => normalizeCombinedInvoicePaymentMethod(order?.payment_method) !== paymentMethod)
        .map((order) => String(order?.id || '').trim())
        .filter(Boolean);

    if (orderIdsToSync.length === 0) return;

    await Order.update(
        { payment_method: paymentMethod as any },
        {
            where: { id: { [Op.in]: orderIdsToSync } },
            transaction
        }
    );

    orders.forEach((order) => {
        if (!orderIdsToSync.includes(String(order?.id || '').trim())) return;
        order.payment_method = paymentMethod;
    });
};

const syncBackordersFromInvoicedQty = async (
    orderItems: any[],
    transaction: any
) => {
    const orderItemIds = orderItems
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean);

    if (orderItemIds.length === 0) return;

    const invoiceItems = await InvoiceItem.findAll({
        where: { order_item_id: { [Op.in]: orderItemIds } },
        transaction
    });

    const invoicedQtyByOrderItemId = new Map<string, number>();
    invoiceItems.forEach((item: any) => {
        const key = String(item?.order_item_id || '').trim();
        if (!key) return;
        const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
        invoicedQtyByOrderItemId.set(key, prev + Number(item?.qty || 0));
    });

    for (const orderItem of orderItems) {
        const orderItemId = String(orderItem?.id || '').trim();
        if (!orderItemId) continue;

        const orderedQtyOriginal = Math.max(
            0,
            Number(orderItem?.ordered_qty_original || orderItem?.qty || 0)
        );
        const canceledBackorderQty = Math.max(
            0,
            Number(orderItem?.qty_canceled_backorder || 0)
        );
        const canceledManualQty = Math.max(
            0,
            Number(orderItem?.qty_canceled_manual || 0)
        );
        const invoicedQty = Math.max(
            0,
            Number(invoicedQtyByOrderItemId.get(orderItemId) || 0)
        );
        const qtyPending = Math.max(0, orderedQtyOriginal - invoicedQty - canceledBackorderQty - canceledManualQty);

        const [backorder] = await Backorder.findOrCreate({
            where: { order_item_id: orderItemId },
            defaults: {
                order_item_id: orderItemId,
                qty_pending: qtyPending,
                status: qtyPending > 0 ? 'waiting_stock' : 'fulfilled'
            },
            transaction
        });

        const nextStatus = qtyPending > 0 ? 'waiting_stock' : 'fulfilled';
        if (
            Number(backorder.qty_pending || 0) !== qtyPending ||
            String(backorder.status || '') !== nextStatus
        ) {
            await backorder.update({
                qty_pending: qtyPending,
                status: nextStatus
            }, { transaction });
        }
    }
};

const computeAllocationByProduct = (allocationsRaw: any[]): Map<string, number> => {
    const allocations = Array.isArray(allocationsRaw) ? allocationsRaw : [];
    const result = new Map<string, number>();
    allocations.forEach((allocation: any) => {
        if (safeLower(allocation?.status) === 'shipped') return;
        const key = String(allocation?.product_id || '').trim();
        if (!key) return;
        result.set(key, n(result.get(key)) + n(allocation?.allocated_qty));
    });
    return result;
};

const distributeAllocationToOrderItems = (orderItemsRaw: any[], allocatedByProduct: Map<string, number>) => {
    const orderItems = Array.isArray(orderItemsRaw) ? orderItemsRaw : [];
    const itemsByProduct = new Map<string, any[]>();
    orderItems.forEach((item: any) => {
        const key = String(item?.product_id || '').trim();
        if (!key) return;
        const bucket = itemsByProduct.get(key) || [];
        bucket.push(item);
        itemsByProduct.set(key, bucket);
    });

    const breakdownByOrderItemId = new Map<string, { ordered_qty: number; allocated_qty: number; shortage_qty: number }>();
    itemsByProduct.forEach((itemsForProduct, productId) => {
        let remainingAlloc = Math.max(0, Math.trunc(n(allocatedByProduct.get(productId))));
        const sortedItems = [...itemsForProduct].sort((a, b) => {
            const aId = Number(a?.id);
            const bId = Number(b?.id);
            if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
            return String(a?.id || '').localeCompare(String(b?.id || ''));
        });

        for (const item of sortedItems) {
            const orderItemId = String(item?.id || '').trim();
            if (!orderItemId) continue;
            const orderedQty = Math.max(0, Math.trunc(n(item?.qty)));
            const allocatedQty = Math.max(0, Math.min(orderedQty, remainingAlloc));
            remainingAlloc = Math.max(0, remainingAlloc - allocatedQty);
            breakdownByOrderItemId.set(orderItemId, {
                ordered_qty: orderedQty,
                allocated_qty: allocatedQty,
                shortage_qty: Math.max(0, orderedQty - allocatedQty),
            });
        }
    });

    return breakdownByOrderItemId;
};

const autoSplitBackorderToChildOrderForInvoice = async (
    order: any,
    transaction: any,
    actor: { id: string | null; role: string | null }
) => {
    const orderId = String(order?.id || '').trim();
    if (!orderId) return null;

    const orderItems = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
    const allocations = Array.isArray(order?.Allocations) ? order.Allocations : [];
    if (orderItems.length === 0) return null;

    const allocatedByProduct = computeAllocationByProduct(allocations);
    const breakdown = distributeAllocationToOrderItems(orderItems, allocatedByProduct);

    let orderedTotal = 0;
    let allocatedTotal = 0;
    let shortageTotal = 0;
    for (const item of orderItems as any[]) {
        const key = String(item?.id || '').trim();
        if (!key) continue;
        const row = breakdown.get(key) || { ordered_qty: Math.max(0, Math.trunc(n(item?.qty))), allocated_qty: 0, shortage_qty: Math.max(0, Math.trunc(n(item?.qty))) };
        orderedTotal += n(row.ordered_qty);
        allocatedTotal += n(row.allocated_qty);
        shortageTotal += n(row.shortage_qty);
    }

    // Split only when there is some allocation to invoice now, but not enough to fulfill the full order demand.
    if (allocatedTotal <= 0) return null;
    if (shortageTotal <= 0) return null;
    if (allocatedTotal >= orderedTotal) return null;

    const fullItemsSubtotal = round2(orderItems.reduce((sum: number, item: any) => sum + (n(item?.price_at_purchase) * Math.max(0, Math.trunc(n(item?.qty)))), 0));
    const parentItemsSubtotal = round2(orderItems.reduce((sum: number, item: any) => {
        const key = String(item?.id || '').trim();
        const row = key ? breakdown.get(key) : null;
        const allocatedQty = row ? n(row.allocated_qty) : 0;
        return sum + (n(item?.price_at_purchase) * Math.max(0, Math.trunc(allocatedQty)));
    }, 0));
    const childItemsSubtotal = round2(Math.max(0, fullItemsSubtotal - parentItemsSubtotal));

    const embeddedDiscountFull = round2(orderItems.reduce((sum: number, item: any) => sum + embeddedDiscountForQty(item, item?.qty), 0));
    const embeddedDiscountParent = round2(orderItems.reduce((sum: number, item: any) => {
        const key = String(item?.id || '').trim();
        const row = key ? breakdown.get(key) : null;
        const allocatedQty = row ? n(row.allocated_qty) : 0;
        return sum + embeddedDiscountForQty(item, allocatedQty);
    }, 0));
    const embeddedDiscountChild = round2(Math.max(0, embeddedDiscountFull - embeddedDiscountParent));

    const discountRaw = n(order?.discount_amount);
    const externalDiscountFull = Math.max(0, round2(discountRaw - embeddedDiscountFull));

    const ratio = fullItemsSubtotal > 0 ? Math.min(1, Math.max(0, parentItemsSubtotal / fullItemsSubtotal)) : 0;
    const externalDiscountParent = round2(externalDiscountFull * ratio);
    const externalDiscountChild = round2(Math.max(0, externalDiscountFull - externalDiscountParent));

    const shippingFeeFull = round2(n(order?.shipping_fee));
    const shippingFeeParent = round2(shippingFeeFull * ratio);
    const shippingFeeChild = round2(shippingFeeFull - shippingFeeParent);

    const discountParent = round2(embeddedDiscountParent + externalDiscountParent);
    const discountChild = round2(embeddedDiscountChild + externalDiscountChild);

    const totalParent = round2(Math.max(0, parentItemsSubtotal + shippingFeeParent - externalDiscountParent));
    const totalChild = round2(Math.max(0, childItemsSubtotal + shippingFeeChild - externalDiscountChild));

    const childOrder = await Order.create({
        parent_order_id: orderId,
        customer_id: order?.customer_id || null,
        customer_name: order?.customer_name || null,
        source: order?.source === 'whatsapp' ? 'whatsapp' : 'web',
        status: 'pending',
        payment_method: order?.payment_method ?? null,
        total_amount: totalChild,
        discount_amount: discountChild,
        pricing_override_note: order?.pricing_override_note ?? null,
        shipping_method_code: order?.shipping_method_code ?? null,
	        shipping_method_name: order?.shipping_method_name ?? null,
	        shipping_fee: shippingFeeChild,
	        shipping_address: order?.shipping_address ?? null,
	        customer_note: order?.customer_note ?? null,
	        expiry_date: order?.expiry_date ?? null,
	        stock_released: false,
	    }, { transaction });

    const parentBefore = {
        total_amount: n(order?.total_amount),
        discount_amount: n(order?.discount_amount),
        shipping_fee: n(order?.shipping_fee),
    };

    await order.update({
        total_amount: totalParent,
        discount_amount: discountParent,
        shipping_fee: shippingFeeParent,
    }, { transaction });

    const childItemIds: string[] = [];
    for (const item of orderItems as any[]) {
        const orderItemId = String(item?.id || '').trim();
        if (!orderItemId) continue;
        const row = breakdown.get(orderItemId);
        const orderedQty = Math.max(0, Math.trunc(n(item?.qty)));
        const allocatedQty = Math.max(0, Math.trunc(n(row?.allocated_qty)));
        const shortageQty = Math.max(0, Math.trunc(orderedQty - allocatedQty));
        if (shortageQty <= 0) {
            // Parent item becomes "fully invoiceable" within parent order.
            const canceledBackorder = Math.max(0, Math.trunc(n(item?.qty_canceled_backorder)));
            const canceledManual = Math.max(0, Math.trunc(n(item?.qty_canceled_manual)));
            const nextOrderedOriginal = Math.max(0, allocatedQty + canceledBackorder + canceledManual);
            if (Number(item.qty || 0) !== allocatedQty || Number(item.ordered_qty_original || 0) !== nextOrderedOriginal) {
                await item.update({
                    qty: allocatedQty,
                    ordered_qty_original: nextOrderedOriginal,
                }, { transaction });
            }
            continue;
        }

        // Move shortage qty to child order (continuation order).
        const createdItem = await OrderItem.create({
            order_id: String(childOrder.id),
            product_id: item.product_id,
            clearance_promo_id: item.clearance_promo_id ?? null,
            preferred_unit_cost: item.preferred_unit_cost ?? null,
            qty: shortageQty,
            ordered_qty_original: shortageQty,
            qty_canceled_backorder: 0,
            qty_canceled_manual: 0,
            price_at_purchase: item.price_at_purchase,
            cost_at_purchase: item.cost_at_purchase,
            pricing_snapshot: item.pricing_snapshot ?? null,
        }, { transaction });
        childItemIds.push(String(createdItem.id));

        await Backorder.create({
            order_item_id: String(createdItem.id),
            qty_pending: shortageQty,
            status: 'waiting_stock',
            notes: `Auto-split from order ${orderId}`,
        } as any, { transaction });

        // Parent keeps only the allocated portion.
        const canceledBackorder = Math.max(0, Math.trunc(n(item?.qty_canceled_backorder)));
        const canceledManual = Math.max(0, Math.trunc(n(item?.qty_canceled_manual)));
        const nextOrderedOriginal = Math.max(0, allocatedQty + canceledBackorder + canceledManual);
        await item.update({
            qty: allocatedQty,
            ordered_qty_original: nextOrderedOriginal,
        }, { transaction });

        const parentBackorder = await Backorder.findOne({
            where: { order_item_id: orderItemId },
            transaction
        });
        if (parentBackorder && safeLower(parentBackorder.status) !== 'canceled') {
            await parentBackorder.update({
                qty_pending: 0,
                status: 'fulfilled',
                notes: parentBackorder.notes
                    ? `${String(parentBackorder.notes)} | Auto-split to child order ${String(childOrder.id)}`
                    : `Auto-split to child order ${String(childOrder.id)}`
            }, { transaction });
        }
    }

    const parentAfter = {
        total_amount: totalParent,
        discount_amount: discountParent,
        shipping_fee: shippingFeeParent,
    };

    await recordOrderEvent({
        transaction,
        order_id: orderId,
        event_type: 'order_pricing_adjusted',
        actor_user_id: actor.id,
        actor_role: actor.role,
        reason: 'auto_split_backorder_to_child_order',
        payload: {
            parent_order_id: orderId,
            child_order_id: String(childOrder.id),
            items_subtotal_full: fullItemsSubtotal,
            items_subtotal_parent: parentItemsSubtotal,
            items_subtotal_child: childItemsSubtotal,
            shipping_fee_full: shippingFeeFull,
            shipping_fee_parent: shippingFeeParent,
            shipping_fee_child: shippingFeeChild,
            discount_full: discountRaw,
            embedded_discount_full: embeddedDiscountFull,
            external_discount_full: externalDiscountFull,
            discount_parent: discountParent,
            discount_child: discountChild,
            external_discount_parent: externalDiscountParent,
            external_discount_child: externalDiscountChild,
            before: parentBefore,
            after: parentAfter,
            child_order_summary: {
                order_id: String(childOrder.id),
                total_amount: totalChild,
                discount_amount: discountChild,
                shipping_fee: shippingFeeChild,
                child_order_item_ids: childItemIds,
            }
        }
    });

    await recordOrderEvent({
        transaction,
        order_id: String(childOrder.id),
        event_type: 'order_pricing_adjusted',
        actor_user_id: actor.id,
        actor_role: actor.role,
        reason: 'auto_split_backorder_from_parent_order',
        payload: {
            parent_order_id: orderId,
            child_order_id: String(childOrder.id),
            items_subtotal: childItemsSubtotal,
            shipping_fee: shippingFeeChild,
            discount_amount: discountChild,
            total_amount: totalChild,
        }
    });

    return {
        parent_order_id: orderId,
        child_order_id: String(childOrder.id),
    };
};

export const issueInvoiceForOrders = async (orderIds: string[], req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const idempotencyScope = buildIssueInvoiceScope(req.user?.id, orderIds);
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan penerbitan invoice duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Hanya kasir atau super admin yang boleh menerbitkan invoice', 403);
        }

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            await t.rollback();
            throw new CustomError('order_ids wajib diisi', 400);
        }

        const orders = await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orders.length !== orderIds.length) {
            await t.rollback();
            throw new CustomError('Beberapa order tidak ditemukan', 404);
        }

        const primaryOrder = orders[0] as any;
        const customerId = String(primaryOrder.customer_id || '');
        const paymentMethod = resolveCombinedInvoicePaymentMethod(orders as any[]);

        // Payment method is intentionally allowed to be "undecided" (null on order, pending on invoice).
        if (paymentMethod && !VALID_COMBINED_INVOICE_PAYMENT_METHODS.has(paymentMethod)) {
            await t.rollback();
            throw new CustomError('Metode pembayaran order tidak valid.', 400);
        }

        for (const order of orders as any[]) {
            if (String(order.status || '') !== 'waiting_invoice') {
                await t.rollback();
                throw new CustomError(`Order ${order.id} status '${order.status}' tidak bisa diterbitkan invoice.`, 400);
            }
            if (String(order.customer_id || '') !== customerId) {
                await t.rollback();
                throw new CustomError('Order harus dari customer yang sama.', 400);
            }
        }

        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        if (paymentMethod) {
            await syncCombinedInvoiceOrderPaymentMethod(orders as any[], paymentMethod, t);
        }

        for (const order of orders as any[]) {
            await autoSplitBackorderToChildOrderForInvoice(order, t, { id: actorId, role: actorRole });
        }

        const orderItemIds = orders
            .flatMap((order: any) => Array.isArray(order.OrderItems) ? order.OrderItems : [])
            .map((item: any) => String(item.id))
            .filter(Boolean);
        const priorInvoiceItems = orderItemIds.length > 0
            ? await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIds } },
                transaction: t
            })
            : [];
        const invoicedQtyByOrderItemId = new Map<string, number>();
        priorInvoiceItems.forEach((item: any) => {
            const key = String(item.order_item_id);
            const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
            invoicedQtyByOrderItemId.set(key, prev + Number(item.qty || 0));
        });

        const invoiceNumber = generateInvoiceNumber(primaryOrder.id);
        const itemsPayload: any[] = [];
        let itemsSubtotal = 0;
        let discountTotal = 0;
        let shippingFeeTotal = 0;
        const ordersWithoutInvoiceLines: string[] = [];

	        for (const order of orders as any[]) {
	            const orderItems = Array.isArray(order.OrderItems) ? order.OrderItems : [];
	            const allocations = Array.isArray(order.Allocations) ? order.Allocations : [];
            const allocatedByProduct = new Map<string, number>();
            allocations.forEach((allocation: any) => {
                const key = String(allocation?.product_id || '');
                if (!key) return;
                allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(allocation?.allocated_qty || 0));
            });

            const orderItemsByProduct = new Map<string, any[]>();
            orderItems.forEach((item: any) => {
                const key = String(item?.product_id || '');
                if (!key) return;
                const list = orderItemsByProduct.get(key) || [];
                list.push(item);
                orderItemsByProduct.set(key, list);
            });
	
	            let orderInvoiceSubtotal = 0;
	            let orderSubtotalFull = 0;
	            let orderEmbeddedDiscountFull = 0;
	            orderItems.forEach((item: any) => {
	                const qty = Number(item.qty || 0);
	                const price = Number(item.price_at_purchase || 0);
	                orderSubtotalFull += Math.round(price * qty * 100) / 100;

	                const snapshot = item?.pricing_snapshot && typeof item.pricing_snapshot === 'object' ? item.pricing_snapshot : null;
	                const basePrice = snapshot ? Number((snapshot as any).base_price) : Number.NaN;
	                const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : price;
	                const embedded = Math.max(0, Math.round((Math.max(0, safeBase - price) * qty) * 100) / 100);
	                orderEmbeddedDiscountFull += embedded;
	            });

            orderItemsByProduct.forEach((itemsForProduct, productId) => {
                let remainingAlloc = Number(allocatedByProduct.get(productId) || 0);
                const sortedItems = [...itemsForProduct].sort((a, b) => {
                    const aId = Number(a.id);
                    const bId = Number(b.id);
                    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                    return String(a.id).localeCompare(String(b.id));
                });

                for (const item of sortedItems) {
                    if (remainingAlloc <= 0) break;
                    const orderedQty = Number(item.qty || 0);
                    if (orderedQty <= 0) continue;

                    const allocQty = Math.min(remainingAlloc, orderedQty);
                    remainingAlloc -= allocQty;

                    const alreadyInvoiced = Number(invoicedQtyByOrderItemId.get(String(item.id)) || 0);
                    const qtyToInvoice = Math.max(0, allocQty - alreadyInvoiced);
                    if (qtyToInvoice <= 0) continue;

                    const price = Number(item.price_at_purchase || 0);
                    const cost = Number(item.cost_at_purchase || 0);
                    const lineTotal = Math.round(price * qtyToInvoice * 100) / 100;
                    itemsSubtotal += lineTotal;
                    orderInvoiceSubtotal += lineTotal;
                    itemsPayload.push({
                        order_item_id: item.id,
                        qty: qtyToInvoice,
                        unit_price: price,
                        unit_cost: cost,
                        line_total: lineTotal
                    });
                }
            });

            if (orderInvoiceSubtotal <= 0) {
                ordersWithoutInvoiceLines.push(String(order.id));
                continue;
            }

	            const ratio = orderSubtotalFull > 0 ? (orderInvoiceSubtotal / orderSubtotalFull) : 0;
	            const orderDiscountRaw = Number(order.discount_amount || 0);
	            // `order.discount_amount` includes embedded discount (already reflected in `price_at_purchase`)
	            // plus possible voucher-style discount (applied on top of line prices). Only the latter
	            // should reduce invoice totals.
	            const externalDiscount = Math.max(0, Math.round((orderDiscountRaw - orderEmbeddedDiscountFull) * 100) / 100);
	            const orderDiscount = externalDiscount * ratio;
	            const orderShipping = Number(order.shipping_fee || 0) * ratio;
	            discountTotal += Math.round(orderDiscount * 100) / 100;
	            shippingFeeTotal += Math.round(orderShipping * 100) / 100;
	        }

        if (ordersWithoutInvoiceLines.length > 0) {
            await t.rollback();
            throw new CustomError(`Order berikut belum memiliki alokasi untuk ditagihkan: ${ordersWithoutInvoiceLines.join(', ')}`, 400);
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item teralokasi untuk diterbitkan invoice.', 400);
        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const invoicePaymentMethod = (paymentMethod && VALID_COMBINED_INVOICE_PAYMENT_METHODS.has(paymentMethod))
            ? paymentMethod
            : 'pending';
        const paymentStatus = invoicePaymentMethod === 'pending' ? 'draft' : 'unpaid';

        const invoice = await Invoice.create({
            order_id: primaryOrder.id,
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: invoicePaymentMethod as any,
            payment_status: paymentStatus,
            amount_paid: 0,
            change_amount: 0,
            subtotal: subtotalBase,
            discount_amount: discountTotal,
            shipping_fee_total: shippingFeeTotal,
            tax_percent: computedTax.tax_percent,
            tax_amount: computedTax.tax_amount,
            total: computedTax.total,
            tax_mode_snapshot: computedTax.tax_mode_snapshot,
            pph_final_amount: computedTax.pph_final_amount
        }, { transaction: t });

        await InvoiceItem.bulkCreate(
            itemsPayload.map((payload) => ({
                ...payload,
                invoice_id: invoice.id
            })),
            { transaction: t }
        );
        await syncBackordersFromInvoicedQty(
            orders.flatMap((order: any) => Array.isArray(order.OrderItems) ? order.OrderItems : []),
            t
        );
        for (const order of orders as any[]) {
            await recordOrderEvent({
                transaction: t,
                order_id: String(order.id),
                invoice_id: String(invoice.id),
                event_type: 'invoice_issued',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    invoice_number: String(invoice.invoice_number || ''),
                    payment_method: String(invoicePaymentMethod || ''),
                    payment_status: String(paymentStatus || ''),
                }
            });
        }
        for (const payload of itemsPayload as any[]) {
            const orderItemId = String(payload?.order_item_id || '');
            const ownerRow = orders
                .flatMap((row: any) => Array.isArray(row.OrderItems) ? row.OrderItems : [])
                .find((item: any) => String(item?.id || '') === orderItemId);
            const ownerOrderId = String(ownerRow?.order_id || primaryOrder.id || '');
            if (!ownerOrderId) continue;
            await recordOrderEvent({
                transaction: t,
                order_id: ownerOrderId,
                order_item_id: orderItemId,
                invoice_id: String(invoice.id),
                event_type: 'invoice_item_billed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: null,
                    after: { invoiced_qty: Number(payload?.qty || 0) },
                    delta: { invoiced_qty: Number(payload?.qty || 0) },
                    line_total: Number(payload?.line_total || 0),
                    unit_price: Number(payload?.unit_price || 0),
                }
            });
        }

        const nextStatus = 'ready_to_ship';
        const expiryDate = null;
        const prevStatusByOrderId: Record<string, string> = {};
        for (const order of orders as any[]) {
            prevStatusByOrderId[String(order.id)] = String(order.status || '');
        }

        await Order.update(
            {
                status: nextStatus,
                expiry_date: expiryDate
            },
            { where: { id: { [Op.in]: orderIds } }, transaction: t }
        );
        for (const order of orders as any[]) {
            const orderId = String(order.id || '');
            const prevStatus = String(prevStatusByOrderId[orderId] || '');
            if (!orderId || prevStatus === nextStatus) continue;
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                event_type: 'order_status_changed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: { status: prevStatus },
                    after: { status: nextStatus },
                    delta: { status_changed: true }
                }
            });
        }

        for (const order of orders as any[]) {
            const prevStatus = String(order.status || '');
            if (prevStatus !== nextStatus) {
                await emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoicePaymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                }, {
                    transaction: t,
                    requestContext: 'finance_issue_invoice_status_changed'
                });
            }
        }

        await t.commit();

        const responsePayload = {
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, responsePayload);
        }
        return res.json(responsePayload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal menerbitkan invoice', 500);
    }
};

// --- Issue Invoice (Kasir step: waiting_invoice → ready_to_ship) ---
export const issueInvoice = asyncWrapper(async (req: Request, res: Response) => {
    const { id } = req.params; // Order ID
    return await issueInvoiceForOrders([String(id)], req, res);
});

export const issueInvoiceBatch = asyncWrapper(async (req: Request, res: Response) => {
    const orderIds = Array.isArray(req.body?.order_ids)
        ? req.body.order_ids.map((value: unknown) => String(value)).filter(Boolean)
        : [];
    return await issueInvoiceForOrders(orderIds, req, res);
});

export const issueInvoiceByItems = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const rawItemsForScope = Array.isArray(req.body?.items) ? req.body.items : [];
    const idempotencyScope = buildIssueInvoiceItemsScope(
        req.user?.id,
        rawItemsForScope.map((item: any) => ({
            order_item_id: String(item?.order_item_id || ''),
            qty: Number(item?.qty || 0)
        }))
    );
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan penerbitan invoice item duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Hanya kasir atau super admin yang boleh menerbitkan invoice', 403);
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const requestedItemsRaw = rawItems
            .map((item: any) => ({
                order_item_id: String(item?.order_item_id || ''),
                qty: Number(item?.qty || 0)
            }))
            .filter((item: any) => item.order_item_id && Number.isFinite(item.qty) && item.qty > 0);

        const requestedItemsMap = new Map<string, number>();
        requestedItemsRaw.forEach((item: any) => {
            const prev = Number(requestedItemsMap.get(item.order_item_id) || 0);
            requestedItemsMap.set(item.order_item_id, prev + Number(item.qty || 0));
        });
        const requestedItems = Array.from(requestedItemsMap.entries()).map(([order_item_id, qty]) => ({
            order_item_id,
            qty
        }));

        if (requestedItems.length === 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi', 400);
        }

        const orderItemIds = Array.from(new Set(requestedItems.map((item: any) => item.order_item_id)));
        const orderItems = await OrderItem.findAll({
            where: { id: { [Op.in]: orderItemIds } },
            include: [{ model: Order }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orderItems.length !== orderItemIds.length) {
            await t.rollback();
            throw new CustomError('Beberapa item order tidak ditemukan', 404);
        }

        const orderItemById = new Map<string, any>();
        const orderIds = new Set<string>();
        let customerId = '';

        for (const item of orderItems as any[]) {
            const order = item.Order;
            if (!order) {
                await t.rollback();
                throw new CustomError('Order untuk item tidak ditemukan', 404);
            }
            const nextCustomerId = String(order.customer_id || '');
            if (!customerId) customerId = nextCustomerId;
            if (nextCustomerId !== customerId) {
                await t.rollback();
                throw new CustomError('Semua item harus berasal dari customer yang sama.', 400);
            }

            if (['canceled', 'expired', 'completed'].includes(String(order.status || ''))) {
                await t.rollback();
                throw new CustomError(`Order ${order.id} sudah selesai atau dibatalkan.`, 400);
            }

            orderItemById.set(String(item.id), item);
            orderIds.add(String(order.id));
        }

        const orders = await Order.findAll({
            where: { id: { [Op.in]: Array.from(orderIds) } },
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const paymentMethod = resolveCombinedInvoicePaymentMethod(orders as any[]);
        if (paymentMethod && !VALID_COMBINED_INVOICE_PAYMENT_METHODS.has(paymentMethod)) {
            await t.rollback();
            throw new CustomError('Metode pembayaran order tidak valid.', 400);
        }
        if (paymentMethod) {
            await syncCombinedInvoiceOrderPaymentMethod(orders as any[], paymentMethod, t);
        }

        const priorInvoiceItems = await InvoiceItem.findAll({
            where: { order_item_id: { [Op.in]: orderItemIds } },
            transaction: t
        });
        const invoicedQtyByOrderItemId = new Map<string, number>();
        priorInvoiceItems.forEach((item: any) => {
            const key = String(item.order_item_id);
            const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
            invoicedQtyByOrderItemId.set(key, prev + Number(item.qty || 0));
        });

	        const availabilityByOrderItemId = new Map<string, number>();
	        const orderFullSubtotalById = new Map<string, number>();
	        const orderEmbeddedDiscountById = new Map<string, number>();

        for (const order of orders as any[]) {
            const orderItemsList = Array.isArray(order.OrderItems) ? order.OrderItems : [];
            const allocations = Array.isArray(order.Allocations) ? order.Allocations : [];

            const allocatedByProduct = new Map<string, number>();
            allocations.forEach((allocation: any) => {
                const key = String(allocation?.product_id || '');
                if (!key) return;
                allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(allocation?.allocated_qty || 0));
            });

	            const orderItemsByProduct = new Map<string, any[]>();
	            let orderSubtotalFull = 0;
	            let orderEmbeddedDiscountFull = 0;
	            orderItemsList.forEach((item: any) => {
	                const qty = Number(item.qty || 0);
	                const price = Number(item.price_at_purchase || 0);
	                orderSubtotalFull += Math.round(price * qty * 100) / 100;

	                const snapshot = item?.pricing_snapshot && typeof item.pricing_snapshot === 'object' ? item.pricing_snapshot : null;
	                const basePrice = snapshot ? Number((snapshot as any).base_price) : Number.NaN;
	                const safeBase = Number.isFinite(basePrice) && basePrice > 0 ? basePrice : price;
	                const embedded = Math.max(0, Math.round((Math.max(0, safeBase - price) * qty) * 100) / 100);
	                orderEmbeddedDiscountFull += embedded;
	
	                const key = String(item?.product_id || '');
	                if (!key) return;
	                const list = orderItemsByProduct.get(key) || [];
                list.push(item);
                orderItemsByProduct.set(key, list);
	            });
	            orderFullSubtotalById.set(String(order.id), orderSubtotalFull);
	            orderEmbeddedDiscountById.set(String(order.id), orderEmbeddedDiscountFull);

            orderItemsByProduct.forEach((itemsForProduct, productId) => {
                let remainingAlloc = Number(allocatedByProduct.get(productId) || 0);
                const sortedItems = [...itemsForProduct].sort((a, b) => {
                    const aId = Number(a.id);
                    const bId = Number(b.id);
                    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                    return String(a.id).localeCompare(String(b.id));
                });

                for (const item of sortedItems) {
                    const orderedQty = Number(item.qty || 0);
                    const allocQty = Math.min(remainingAlloc, orderedQty);
                    remainingAlloc -= allocQty;

                    const alreadyInvoiced = Number(invoicedQtyByOrderItemId.get(String(item.id)) || 0);
                    const available = Math.max(0, allocQty - alreadyInvoiced);
                    availabilityByOrderItemId.set(String(item.id), available);
                }
            });
        }

        const invoiceNumber = generateInvoiceNumber(String(orders[0]?.id || orderItems[0]?.order_id || Date.now()));
        const itemsPayload: any[] = [];
        let itemsSubtotal = 0;
        let discountTotal = 0;
        let shippingFeeTotal = 0;

        const orderSelectedSubtotalById = new Map<string, number>();
        let validationError: string | null = null;
        requestedItems.forEach((reqItem: any) => {
            const orderItem = orderItemById.get(reqItem.order_item_id);
            if (!orderItem) return;
            const available = Number(availabilityByOrderItemId.get(reqItem.order_item_id) || 0);
            if (reqItem.qty > available) {
                const orderId = String(orderItem.order_id || '').trim();
                const productId = String(orderItem.product_id || '').trim();
                validationError = `Qty invoice melebihi alokasi untuk item ${reqItem.order_item_id} (order_id=${orderId || '-'}, product_id=${productId || '-'}, requested=${Number(reqItem.qty || 0)}, available=${available}).`;
                return;
            }

            const price = Number(orderItem.price_at_purchase || 0);
            const cost = Number(orderItem.cost_at_purchase || 0);
            const lineTotal = Math.round(price * reqItem.qty * 100) / 100;
            itemsSubtotal += lineTotal;
            itemsPayload.push({
                order_item_id: orderItem.id,
                qty: reqItem.qty,
                unit_price: price,
                unit_cost: cost,
                line_total: lineTotal
            });

            const orderId = String(orderItem.order_id || '');
            const prev = Number(orderSelectedSubtotalById.get(orderId) || 0);
            orderSelectedSubtotalById.set(orderId, prev + lineTotal);
        });

        if (validationError) {
            await t.rollback();
            throw new CustomError(validationError, 400);
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            throw new CustomError('Tidak ada item teralokasi untuk diterbitkan invoice.', 400);
        }

	        for (const order of orders as any[]) {
	            const orderId = String(order.id || '');
	            const selectedSubtotal = Number(orderSelectedSubtotalById.get(orderId) || 0);
	            if (selectedSubtotal <= 0) continue;
	            const orderSubtotalFull = Number(orderFullSubtotalById.get(orderId) || 0);
	            const ratio = orderSubtotalFull > 0 ? (selectedSubtotal / orderSubtotalFull) : 0;
	            const orderDiscountRaw = Number(order.discount_amount || 0);
	            const embeddedDiscountFull = Number(orderEmbeddedDiscountById.get(orderId) || 0);
	            const externalDiscount = Math.max(0, Math.round((orderDiscountRaw - embeddedDiscountFull) * 100) / 100);
	            const orderDiscount = externalDiscount * ratio;
	            const orderShipping = Number(order.shipping_fee || 0) * ratio;
	            discountTotal += Math.round(orderDiscount * 100) / 100;
	            shippingFeeTotal += Math.round(orderShipping * 100) / 100;
	        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const invoicePaymentMethod = (paymentMethod && VALID_COMBINED_INVOICE_PAYMENT_METHODS.has(paymentMethod))
            ? paymentMethod
            : 'pending';
        const paymentStatus = invoicePaymentMethod === 'pending' ? 'draft' : 'unpaid';
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        const invoice = await Invoice.create({
            order_id: String(orders[0]?.id || null),
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: invoicePaymentMethod as any,
            payment_status: paymentStatus,
            amount_paid: 0,
            change_amount: 0,
            subtotal: subtotalBase,
            discount_amount: discountTotal,
            shipping_fee_total: shippingFeeTotal,
            tax_percent: computedTax.tax_percent,
            tax_amount: computedTax.tax_amount,
            total: computedTax.total,
            tax_mode_snapshot: computedTax.tax_mode_snapshot,
            pph_final_amount: computedTax.pph_final_amount
        }, { transaction: t });

        await InvoiceItem.bulkCreate(
            itemsPayload.map((payload) => ({
                ...payload,
                invoice_id: invoice.id
            })),
            { transaction: t }
        );
        await syncBackordersFromInvoicedQty(orderItems as any[], t);
        for (const order of orders as any[]) {
            const orderId = String(order.id || '').trim();
            if (!orderId) continue;
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                invoice_id: String(invoice.id),
                event_type: 'invoice_issued',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    invoice_number: String(invoice.invoice_number || ''),
                    payment_method: String(invoicePaymentMethod || ''),
                    payment_status: String(paymentStatus || ''),
                }
            });
        }
        for (const payload of itemsPayload as any[]) {
            const orderItemId = String(payload?.order_item_id || '').trim();
            const orderItem = orderItemById.get(orderItemId);
            const orderId = String(orderItem?.order_id || '').trim();
            if (!orderId || !orderItemId) continue;
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                order_item_id: orderItemId,
                invoice_id: String(invoice.id),
                event_type: 'invoice_item_billed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: null,
                    after: { invoiced_qty: Number(payload?.qty || 0) },
                    delta: { invoiced_qty: Number(payload?.qty || 0) },
                    line_total: Number(payload?.line_total || 0),
                    unit_price: Number(payload?.unit_price || 0),
                }
            });
        }

        const nextStatus = 'ready_to_ship';
        const expiryDate = null;

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

        const ordersWithLines = orders.filter((order: any) => Number(orderSelectedSubtotalById.get(String(order.id)) || 0) > 0);
        const prevStatusByOrderId: Record<string, string> = {};
        for (const order of ordersWithLines as any[]) {
            const orderId = String(order.id);
            const currentStatus = String(order.status || '');
            prevStatusByOrderId[orderId] = currentStatus;
            const currentRank = Number(statusProgressRank[currentStatus] || 0);
            const targetRank = Number(statusProgressRank[nextStatus] || 0);
            if (currentRank >= targetRank) continue;
            await order.update(
                { status: nextStatus, expiry_date: expiryDate },
                { transaction: t }
            );
            await recordOrderEvent({
                transaction: t,
                order_id: orderId,
                event_type: 'order_status_changed',
                actor_user_id: actorId,
                actor_role: actorRole,
                payload: {
                    before: { status: currentStatus },
                    after: { status: nextStatus },
                    delta: { status_changed: true }
                }
            });
        }

        for (const order of ordersWithLines as any[]) {
            const orderId = String(order.id);
            const prevStatus = prevStatusByOrderId[orderId] || '';
            if (prevStatus !== nextStatus) {
                await emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoicePaymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                }, {
                    transaction: t,
                    requestContext: 'finance_issue_invoice_batch_status_changed'
                });
            }
        }

        await t.commit();

        const responsePayload = {
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, responsePayload);
        }
        return res.json(responsePayload);
    } catch (error: any) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        const message = typeof error?.message === 'string' ? error.message : 'Gagal menerbitkan invoice';
        throw new CustomError(message, 500);
    }
});
