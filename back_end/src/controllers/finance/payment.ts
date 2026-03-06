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

export const verifyPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const { action } = req.body; // 'approve' | 'reject'
        const verifierId = req.user!.id;
        const verifierRole = req.user!.role;

        if (!['admin_finance', 'super_admin'].includes(verifierRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin finance atau super admin yang boleh verifikasi pembayaran' });
        }

        if (action !== 'approve' && action !== 'reject') {
            await t.rollback();
            return res.status(400).json({ message: 'Invalid action' });
        }

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE })
            || await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
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
            return res.status(404).json({ message: 'Order tidak ditemukan untuk invoice ini' });
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
                return res.status(409).json({ message: 'Invoice COD/Cash Store hanya boleh menjadi paid melalui proses settlement.' });
            }

            if (!isNoProofMethod && !invoice.payment_proof_url) {
                await t.rollback();
                return res.status(400).json({ message: 'Bukti transfer belum tersedia untuk diverifikasi' });
            }

            if (invoice.payment_status === 'paid') {
                await t.rollback();
                return res.status(409).json({ message: 'Pembayaran sudah pernah di-approve' });
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
            const toReadyToShipIds: string[] = [];
            orders.forEach((order: any) => {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) return;
                if (['completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    return;
                }
                if (currentStatus === 'delivered') {
                    toCompletedIds.push(orderId);
                    nextStatusByOrderId[orderId] = 'completed';
                    return;
                }
                if (currentStatus === 'shipped') {
                    nextStatusByOrderId[orderId] = 'shipped';
                    return;
                }
                toReadyToShipIds.push(orderId);
                nextStatusByOrderId[orderId] = 'ready_to_ship';
            });
            if (toReadyToShipIds.length > 0) {
                await Order.update(
                    { status: 'ready_to_ship', expiry_date: null },
                    { where: { id: { [Op.in]: toReadyToShipIds } }, transaction: t }
                );
            }
            if (toCompletedIds.length > 0) {
                await Order.update(
                    { status: 'completed' },
                    { where: { id: { [Op.in]: toCompletedIds } }, transaction: t }
                );
            }

        } else {
            // Payment rejected but order should still proceed to warehouse (payment handled by driver).
            await invoice.update({
                payment_status: 'unpaid',
                payment_proof_url: null,
                verified_by: null,
                verified_at: null
            }, { transaction: t });
            const toReadyToShipIds: string[] = [];
            orders.forEach((order: any) => {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) return;
                if (['delivered', 'shipped', 'completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    return;
                }
                toReadyToShipIds.push(orderId);
                nextStatusByOrderId[orderId] = 'ready_to_ship';
            });
            if (toReadyToShipIds.length > 0) {
                await Order.update({
                    status: 'ready_to_ship',
                    expiry_date: null
                }, { where: { id: { [Op.in]: toReadyToShipIds } }, transaction: t });
            }
        }

        await t.commit();
        orders.forEach((order: any) => {
            const orderId = String(order.id || '');
            const prevStatus = String(previousStatusByOrderId[orderId] || order.status || '');
            const nextStatus = String(nextStatusByOrderId[orderId] || prevStatus);
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
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
                });
            }
        });
        emitAdminRefreshBadges();

        res.json({ message: `Payment ${action}d` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error verifying payment', error });
    }
};

export const voidPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Invoice ID or Order ID? Let's use Invoice ID for precision
        const userId = req.user!.id;

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status !== 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice belum dibayar/status bukan paid.' });
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
            return res.status(404).json({ message: 'Associated orders not found' });
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
        const nextOrderStatus = 'ready_to_ship';
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

        await t.commit();
        orders.forEach((order) => {
            const previousStatus = previousOrderStatusById[String(order.id)] || '';
            if (previousStatus !== nextOrderStatus && order.status !== 'canceled') {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: previousStatus,
                    to_status: nextOrderStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: ['admin_finance', 'customer'],
                });
            }
        });
        emitAdminRefreshBadges();

        res.json({ message: 'Pembayaran berhasil di-void (Reversed)' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error voiding payment', error });
    }
};

