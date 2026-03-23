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
        const invoicedQty = Math.max(
            0,
            Number(invoicedQtyByOrderItemId.get(orderItemId) || 0)
        );
        const qtyPending = Math.max(0, orderedQtyOriginal - invoicedQty - canceledBackorderQty);

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

        if (paymentMethod) {
            await syncCombinedInvoiceOrderPaymentMethod(orders as any[], paymentMethod, t);
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
            orderItems.forEach((item: any) => {
                const qty = Number(item.qty || 0);
                const price = Number(item.price_at_purchase || 0);
                orderSubtotalFull += Math.round(price * qty * 100) / 100;
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
            const orderDiscount = Number(order.discount_amount || 0) * ratio;
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

        const invoicePaymentMethod = paymentMethod === 'cash_store' ? 'cash_store' : 'pending';
        const paymentStatus = paymentMethod === 'cash_store' ? 'unpaid' : 'draft';
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

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
            orderItemsList.forEach((item: any) => {
                const qty = Number(item.qty || 0);
                const price = Number(item.price_at_purchase || 0);
                orderSubtotalFull += Math.round(price * qty * 100) / 100;

                const key = String(item?.product_id || '');
                if (!key) return;
                const list = orderItemsByProduct.get(key) || [];
                list.push(item);
                orderItemsByProduct.set(key, list);
            });
            orderFullSubtotalById.set(String(order.id), orderSubtotalFull);

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
                validationError = `Qty invoice melebihi alokasi untuk item ${reqItem.order_item_id}.`;
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
            const orderDiscount = Number(order.discount_amount || 0) * ratio;
            const orderShipping = Number(order.shipping_fee || 0) * ratio;
            discountTotal += Math.round(orderDiscount * 100) / 100;
            shippingFeeTotal += Math.round(orderShipping * 100) / 100;
        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const invoicePaymentMethod = paymentMethod === 'cash_store' ? 'cash_store' : 'pending';
        const paymentStatus = paymentMethod === 'cash_store' ? 'unpaid' : 'draft';
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
