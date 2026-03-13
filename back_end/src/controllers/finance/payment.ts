import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting, Backorder } from '../../models';
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
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

export const verifyPayment = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const { action } = req.body; // 'approve' | 'reject'
        const verifierId = req.user!.id;
        const verifierRole = req.user!.role;

        if (!['admin_finance', 'super_admin'].includes(verifierRole)) {
            await t.rollback();
            throw new CustomError('Hanya admin finance atau super admin yang boleh verifikasi pembayaran', 403);
        }

        if (action !== 'approve' && action !== 'reject') {
            await t.rollback();
            throw new CustomError('Invalid action', 400);
        }

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE })
            || await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice not found', 404);
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        const orders = uniqueOrderIds.length > 0
            ? await Order.findAll({ where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t, lock: t.LOCK.UPDATE })
            : [];
        if (orders.length === 0) {
            await t.rollback();
            throw new CustomError('Order tidak ditemukan untuk invoice ini', 404);
        }
        const previousStatusByOrderId: Record<string, string> = {};
        const nextStatusByOrderId: Record<string, string> = {};
        orders.forEach((order: any) => {
            const orderId = String(order.id || '');
            if (!orderId) return;
            const status = String(order.status || '');
            previousStatusByOrderId[orderId] = status;
            nextStatusByOrderId[orderId] = status;
        });
        if (action === 'approve') {
            const isNoProofMethod = ['cod', 'cash_store'].includes(invoice.payment_method);

            if (isNoProofMethod) {
                await t.rollback();
                throw new CustomError('Invoice COD/Cash Store hanya boleh menjadi paid melalui proses settlement.', 409);
            }

            if (!isNoProofMethod && !invoice.payment_proof_url) {
                await t.rollback();
                throw new CustomError('Bukti transfer belum tersedia untuk diverifikasi', 400);
            }

            if (invoice.payment_status === 'paid') {
                await t.rollback();
                throw new CustomError('Pembayaran sudah pernah di-approve', 409);
            }

            await invoice.update({
                payment_status: 'paid',
                verified_by: verifierId,
                verified_at: new Date(),
                amount_paid: Number(invoice.total || 0)
            }, { transaction: t });

            const totalAmount = Number(invoice.total || 0);
            const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
            const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
            const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });

            if (paymentAcc && arAcc && totalAmount > 0) {
                await JournalService.createEntry({
                    description: `Verifikasi Pembayaran Invoice #${invoice.invoice_number}`,
                    reference_type: 'payment_verify',
                    reference_id: invoice.id.toString(),
                    created_by: verifierId,
                    idempotency_key: `payment_verify_${invoice.id}`,
                    lines: [
                        { account_id: paymentAcc.id, debit: totalAmount, credit: 0 },
                        { account_id: arAcc.id, debit: 0, credit: totalAmount }
                    ]
                }, t);
            }

            const toCompletedIds: string[] = [];
            const toPartiallyFulfilledIds: string[] = [];
            for (const order of orders as any[]) {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) continue;
                if (['completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    continue;
                }
                const orderItems = await OrderItem.findAll({
                    where: { order_id: orderId },
                    attributes: ['id'],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const orderItemIds = orderItems.map((row: any) => String(row.id)).filter(Boolean);
                const openBackorderCount = orderItemIds.length > 0
                    ? await Backorder.count({
                        where: {
                            order_item_id: { [Op.in]: orderItemIds },
                            qty_pending: { [Op.gt]: 0 },
                            status: { [Op.notIn]: ['fulfilled', 'canceled'] }
                        },
                        transaction: t
                    })
                    : 0;
                const nextStatus = openBackorderCount > 0 ? 'partially_fulfilled' : 'completed';
                if (!isOrderTransitionAllowed(currentStatus, nextStatus)) {
                    throw new CustomError(`Transisi status tidak diizinkan: '${currentStatus}' -> '${nextStatus}'`, 409);
                }
                if (nextStatus === 'completed') {
                    toCompletedIds.push(orderId);
                } else {
                    toPartiallyFulfilledIds.push(orderId);
                }
                nextStatusByOrderId[orderId] = nextStatus;
            }
            if (toPartiallyFulfilledIds.length > 0) {
                await Order.update(
                    { status: 'partially_fulfilled' },
                    { where: { id: { [Op.in]: toPartiallyFulfilledIds } }, transaction: t }
                );
            }
            if (toCompletedIds.length > 0) {
                await Order.update(
                    { status: 'completed' },
                    { where: { id: { [Op.in]: toCompletedIds } }, transaction: t }
                );
            }

        } else {
            // Payment rejected. Hold the order to prevent it from going to warehouse.
            await invoice.update({
                payment_status: 'unpaid',
                payment_proof_url: null,
                verified_by: null,
                verified_at: null
            }, { transaction: t });
            const toHoldIds: string[] = [];
            orders.forEach((order: any) => {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) return;
                if (['delivered', 'shipped', 'completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    return;
                }
                if (!isOrderTransitionAllowed(currentStatus, 'hold')) {
                    throw new CustomError(`Transisi status tidak diizinkan: '${currentStatus}' -> 'hold'`, 409);
                }
                toHoldIds.push(orderId);
                nextStatusByOrderId[orderId] = 'hold';
            });
            if (toHoldIds.length > 0) {
                await Order.update({
                    status: 'hold',
                    expiry_date: null
                }, { where: { id: { [Op.in]: toHoldIds } }, transaction: t });
            }
        }

        for (const order of orders as any[]) {
            const orderId = String(order.id || '');
            const prevStatus = String(previousStatusByOrderId[orderId] || order.status || '');
            const nextStatus = String(nextStatusByOrderId[orderId] || prevStatus);
            if (prevStatus !== nextStatus) {
                await emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: verifierRole,
                    target_roles: action === 'approve'
                        ? (nextStatus === 'completed' ? ['admin_finance', 'customer'] : ['admin_gudang', 'customer'])
                        : ['customer'],
                }, {
                    transaction: t,
                    requestContext: 'finance_verify_payment_status_changed'
                });
            }
        }
        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'finance_verify_payment_refresh_badges'
        });

        await t.commit();

        res.json({ message: `Payment ${action}d` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error verifying payment', 500);
    }
});

export const voidPayment = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const idempotencyScope = `finance_void_payment:${String(req.user?.id || '').trim()}:${String(req.params?.id || '').trim()}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan void pembayaran duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Invoice ID or Order ID? Let's use Invoice ID for precision
        const userId = req.user!.id;

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice not found', 404);
        }

        if (invoice.payment_status !== 'paid') {
            await t.rollback();
            throw new CustomError('Invoice belum dibayar/status bukan paid.', 400);
        }

        const existingReversalCount = await Journal.count({
            where: {
                reference_type: 'order_reversal',
                reference_id: String(invoice.id)
            },
            transaction: t
        });
        if (existingReversalCount > 0) {
            await t.rollback();
            throw new CustomError('Invoice ini sudah pernah di-void/reversal sebelumnya.', 409);
        }

        // 1. Find the Journal related to this payment
        // We look for journal with reference_type='order' and reference_id=order_id created closely?
        // Or we just create a reversal based on invoice amount.
        // Better: Re-calculate what the journal WAS (Sales + COGS) and reverse it.
        // Since we don't store journal_id on invoice, we construct the reversal.

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        const orders = uniqueOrderIds.length > 0
            ? await Order.findAll({ where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t, lock: t.LOCK.UPDATE })
            : [];
        if (orders.length === 0) {
            await t.rollback();
            throw new CustomError('Associated orders not found', 404);
        }

        const nextOrderStatus = 'ready_to_ship';
        for (const order of orders as any[]) {
            const currentStatus = String(order?.status || '').toLowerCase();
            if (currentStatus === 'canceled') continue;
            if (!isOrderTransitionAllowed(currentStatus, nextOrderStatus)) {
                await t.rollback();
                throw new CustomError(`Transisi status tidak diizinkan: '${currentStatus}' -> '${nextOrderStatus}'`, 409);
            }
        }

        // REVERSE SALES JOURNAL
        const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
        const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
        const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

        if (paymentAcc && revenueAcc) {
            await JournalService.createEntry({
                description: `[VOID/REVERSAL] Penjualan Invoice #${invoice.invoice_number}`,
                reference_type: 'order_reversal',
                reference_id: invoice.id.toString(),
                created_by: userId,
                lines: [
                    { account_id: paymentAcc.id, debit: 0, credit: Number(invoice.amount_paid) }, // Credit Cash
                    { account_id: revenueAcc.id, debit: Number(invoice.amount_paid), credit: 0 }  // Debit Revenue
                ]
            }, t);
        }

        // REVERSE COGS JOURNAL
        // Recalculate COGS from invoice items to support multi-order invoices.
        const invoiceItems = await InvoiceItem.findAll({
            where: { invoice_id: invoice.id },
            attributes: ['qty', 'unit_cost'],
            transaction: t
        });
        let totalCost = 0;
        invoiceItems.forEach((item: any) => {
            totalCost += Number(item.unit_cost || 0) * Number(item.qty || 0);
        });

        if (totalCost > 0) {
            const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
            const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });

            if (hppAcc && inventoryAcc) {
                await JournalService.createEntry({
                    description: `[VOID/REVERSAL] HPP Invoice #${invoice.invoice_number}`,
                    reference_type: 'order_reversal',
                    reference_id: invoice.id.toString(),
                    created_by: userId,
                    lines: [
                        { account_id: hppAcc.id, debit: 0, credit: totalCost }, // Credit HPP (Reduce Expense)
                        { account_id: inventoryAcc.id, debit: totalCost, credit: 0 } // Debit Inventory (Increase Asset)
                    ]
                }, t);
            }
        }

        // 2. Reset Invoice
        await invoice.update({
            payment_status: 'unpaid',
            amount_paid: 0,
            verified_at: null,
            verified_by: null
        }, { transaction: t });

        // 3. Reset Order Status
        const previousOrderStatusById: Record<string, string> = {};
        orders.forEach((order) => {
            previousOrderStatusById[String(order.id)] = String(order.status || '');
        });
        await Order.update({
            status: 'ready_to_ship',
            expiry_date: null
        }, {
            where: {
                id: { [Op.in]: uniqueOrderIds },
                status: { [Op.ne]: 'canceled' }
            },
            transaction: t
        });

        for (const order of orders as any[]) {
            const previousStatus = previousOrderStatusById[String(order.id)] || '';
            if (previousStatus !== nextOrderStatus && order.status !== 'canceled') {
                await emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: previousStatus,
                    to_status: nextOrderStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: ['admin_finance', 'customer'],
                }, {
                    transaction: t,
                    requestContext: 'finance_void_payment_status_changed'
                });
            }
        }
        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: 'finance_void_payment_refresh_badges'
        });

        await t.commit();

        const responsePayload = { message: 'Pembayaran berhasil di-void (Reversed)' };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, responsePayload);
        }
        res.json(responsePayload);

    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error voiding payment', 500);
    }
});
