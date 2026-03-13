import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

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
        const driverUser = await User.findByPk(userId, {
            attributes: ['id', 'name', 'debt']
        });

        const debtFromFinance = Number(driverUser?.debt || 0);
        // Use the calculated total for UI if it's more accurate (e.g. recent deliveries)
        const displayDebt = Math.max(debtFromFinance, totalCash);

        res.json({
            driver_id: userId,
            cash_on_hand: displayDebt,
            debt: displayDebt,
            cod_pending_calculated: totalCash,
            orders: details
        });

    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching wallet', 500);
    }
});
