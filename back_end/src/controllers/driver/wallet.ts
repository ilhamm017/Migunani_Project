import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem, DriverBalanceAdjustment } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { calculateDriverCodExposure } from '../../utils/codExposure';

export const getDriverWallet = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        // Calculated COD exposure from the latest open COD invoice per order only.
        // Older COD invoices must not keep inflating wallet exposure.
        const invoiceItems = await InvoiceItem.findAll({
            include: [{
                model: Invoice,
                required: true
            }, {
                model: OrderItem,
                include: [{
                    model: Order,
                    where: { courier_id: userId },
                    required: true
                }],
                required: true
            }]
        });

        const latestInvoiceByOrderId = new Map<string, any>();

        invoiceItems.forEach((item: any) => {
            const invoice = item.Invoice;
            const orderId = item.OrderItem?.order_id;
            if (!invoice || !orderId) return;

            const orderIdKey = String(orderId);
            const existing = latestInvoiceByOrderId.get(orderIdKey);
            const invoiceTime = new Date(String(invoice.createdAt || 0)).getTime();
            const existingTime = existing ? new Date(String(existing.createdAt || 0)).getTime() : -1;
            if (!existing || invoiceTime > existingTime) {
                latestInvoiceByOrderId.set(orderIdKey, invoice);
            }
        });

        const invoiceIdMap = new Map<string, any>();
        const invoiceOrdersMap = new Map<string, Set<string>>();
        latestInvoiceByOrderId.forEach((invoice, orderId) => {
            if (String(invoice.payment_method || '') !== 'cod' || String(invoice.payment_status || '') !== 'cod_pending') {
                return;
            }

            const invId = String(invoice.id);
            invoiceIdMap.set(invId, invoice);

            const orders = invoiceOrdersMap.get(invId) || new Set<string>();
            orders.add(String(orderId));
            invoiceOrdersMap.set(invId, orders);
        });

        let totalCash = 0;
        const details: any[] = [];

        invoiceIdMap.forEach((inv, invId) => {
            const invoiceTotal = Number(inv.total || 0);
            const amount = Number(inv.amount_paid) > 0 ? Number(inv.amount_paid) : invoiceTotal;
            totalCash += amount;

            const orderIds = Array.from(invoiceOrdersMap.get(invId) || []);
            details.push({
                order_id: orderIds[0] || null,
                invoice_number: inv.invoice_number,
                amount,
                order_ids: orderIds,
                created_at: inv.createdAt
            });
        });

        // Current source of truth for UI display
        const exposure = await calculateDriverCodExposure(String(userId));
        const displayDebt = exposure.exposure > 0 ? exposure.exposure : totalCash;

        const adjustments = await DriverBalanceAdjustment.findAll({
            where: { driver_id: userId, status: 'open' }
        });
        const adjustmentEntries = adjustments.map((row: any) => ({
            id: String(row.id || ''),
            direction: String(row.direction || '').trim(),
            reason: String(row.reason || '').trim(),
            amount: Math.round(Number(row.amount || 0) * 100) / 100,
            note: typeof row.note === 'string' ? row.note : null,
            created_at: row.createdAt ? new Date(String(row.createdAt)).toISOString() : null,
        }));
        const outstandingAdjustment = adjustmentEntries
            .filter((entry) => entry.direction === 'debt')
            .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

        res.json({
            driver_id: userId,
            cash_on_hand: displayDebt,
            debt: displayDebt,
            cod_pending_calculated: totalCash,
            balance_adjustments: {
                total_outstanding: Math.round(outstandingAdjustment * 100) / 100,
                entries: adjustmentEntries,
            },
            orders: details
        });

    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching wallet', 500);
    }
});
