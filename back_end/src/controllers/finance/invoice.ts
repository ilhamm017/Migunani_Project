import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting } from '../../models';
import { Op } from 'sequelize';
import { JournalService } from '../../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../../utils/orderNotification';
import { generateInvoiceNumber } from '../../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';


import {
  toSafeText, normalizeExpenseDetails, parseExpenseNote, buildExpenseNote, ensureDefaultExpenseLabels,
  genCreditNoteNumber, normalizeTaxNumber, buildAccountsReceivableInclude, buildAccountsReceivableContext, mapAccountsReceivableRows,
} from './utils';

export const issueInvoiceForOrders = async (orderIds: string[], req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya kasir atau super admin yang boleh menerbitkan invoice' });
        }

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'order_ids wajib diisi' });
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
            return res.status(404).json({ message: 'Beberapa order tidak ditemukan' });
        }

        const primaryOrder = orders[0] as any;
        const customerId = String(primaryOrder.customer_id || '');
        const paymentMethod = String(primaryOrder.payment_method || '');

        if (!['transfer_manual', 'cod', 'cash_store'].includes(paymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran order belum ditentukan.' });
        }

        for (const order of orders as any[]) {
            if (String(order.status || '') !== 'waiting_invoice') {
                await t.rollback();
                return res.status(400).json({ message: `Order ${order.id} status '${order.status}' tidak bisa diterbitkan invoice.` });
            }
            if (String(order.customer_id || '') !== customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Order harus dari customer yang sama.' });
            }
            if (String(order.payment_method || '') !== paymentMethod) {
                await t.rollback();
                return res.status(400).json({ message: 'Metode pembayaran harus sama untuk invoice gabungan.' });
            }
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
            return res.status(400).json({
                message: `Order berikut belum memiliki alokasi untuk ditagihkan: ${ordersWithoutInvoiceLines.join(', ')}`
            });
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item teralokasi untuk diterbitkan invoice.' });
        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const paymentStatus = paymentMethod === 'cod' || paymentMethod === 'cash_store'
            ? 'cod_pending'
            : 'unpaid';

        const invoice = await Invoice.create({
            order_id: primaryOrder.id,
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: paymentMethod as any,
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

        const nextStatus = 'ready_to_ship';
        const expiryDate = null;

        await Order.update(
            {
                status: nextStatus,
                expiry_date: expiryDate
            },
            { where: { id: { [Op.in]: orderIds } }, transaction: t }
        );

        await t.commit();

        for (const order of orders as any[]) {
            const prevStatus = String(order.status || '');
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(paymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                });
            }
        }

        return res.json({
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Gagal menerbitkan invoice', error });
    }
};

// --- Issue Invoice (Kasir step: waiting_invoice → ready_to_ship) ---
export const issueInvoice = async (req: Request, res: Response) => {
    const { id } = req.params; // Order ID
    return issueInvoiceForOrders([String(id)], req, res);
};

export const issueInvoiceBatch = async (req: Request, res: Response) => {
    const orderIds = Array.isArray(req.body?.order_ids)
        ? req.body.order_ids.map((value: unknown) => String(value)).filter(Boolean)
        : [];
    return issueInvoiceForOrders(orderIds, req, res);
};

export const issueInvoiceByItems = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya kasir atau super admin yang boleh menerbitkan invoice' });
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
            return res.status(400).json({ message: 'items wajib diisi' });
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
            return res.status(404).json({ message: 'Beberapa item order tidak ditemukan' });
        }

        const orderItemById = new Map<string, any>();
        const orderIds = new Set<string>();
        let customerId = '';
        let paymentMethod = '';

        for (const item of orderItems as any[]) {
            const order = item.Order;
            if (!order) {
                await t.rollback();
                return res.status(404).json({ message: 'Order untuk item tidak ditemukan' });
            }
            const nextCustomerId = String(order.customer_id || '');
            if (!customerId) customerId = nextCustomerId;
            if (nextCustomerId !== customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Semua item harus berasal dari customer yang sama.' });
            }

            const nextPaymentMethod = String(order.payment_method || '');
            if (!paymentMethod) paymentMethod = nextPaymentMethod;
            if (nextPaymentMethod !== paymentMethod) {
                await t.rollback();
                return res.status(400).json({ message: 'Metode pembayaran harus sama untuk invoice gabungan.' });
            }

            if (['canceled', 'expired', 'completed'].includes(String(order.status || ''))) {
                await t.rollback();
                return res.status(400).json({ message: `Order ${order.id} sudah selesai atau dibatalkan.` });
            }

            orderItemById.set(String(item.id), item);
            orderIds.add(String(order.id));
        }

        if (!['transfer_manual', 'cod', 'cash_store'].includes(paymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran order belum ditentukan.' });
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
            return res.status(400).json({ message: validationError });
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item teralokasi untuk diterbitkan invoice.' });
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

        const paymentStatus = paymentMethod === 'cod' || paymentMethod === 'cash_store'
            ? 'cod_pending'
            : 'unpaid';

        const invoice = await Invoice.create({
            order_id: String(orders[0]?.id || null),
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: paymentMethod as any,
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
        }

        await t.commit();

        for (const order of ordersWithLines as any[]) {
            const orderId = String(order.id);
            const prevStatus = prevStatusByOrderId[orderId] || '';
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(paymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                });
            }
        }

        return res.json({
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        });
    } catch (error: any) {
        await t.rollback();
        const message = typeof error?.message === 'string' ? error.message : 'Gagal menerbitkan invoice';
        return res.status(500).json({ message, error });
    }
};

