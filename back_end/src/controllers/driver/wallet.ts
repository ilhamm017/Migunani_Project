import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';

export const getDriverWallet = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;

        // Calculated COD exposure from open COD invoices (for audit/comparison).
        const orders = await Order.findAll({
            where: {
                courier_id: userId,
                status: { [Op.in]: ['delivered', 'completed'] }
            },
            attributes: ['id']
        });

        const orderIds = orders.map((order) => String(order.id));
        let totalCash = 0;
        const details = [];

        if (orderIds.length > 0) {
            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: orderIds } },
                attributes: ['id', 'order_id']
            });
            const orderItemIds = orderItems.map((item: any) => String(item.id));
            const orderItemToOrderId = new Map<string, string>();
            orderItems.forEach((item: any) => {
                orderItemToOrderId.set(String(item.id), String(item.order_id));
            });

            if (orderItemIds.length > 0) {
                const invoiceItems = await InvoiceItem.findAll({
                    where: { order_item_id: { [Op.in]: orderItemIds } },
                    include: [{
                        model: Invoice,
                        where: {
                            payment_method: 'cod',
                            payment_status: 'cod_pending'
                        },
                        required: true
                    }]
                });

                const invoiceMap = new Map<string, { invoice: any; orderIds: Set<string> }>();
                invoiceItems.forEach((item: any) => {
                    const invoice = item.Invoice;
                    if (!invoice) return;
                    const invoiceId = String(invoice.id);
                    const orderId = orderItemToOrderId.get(String(item.order_item_id)) || '';
                    const entry = invoiceMap.get(invoiceId) || { invoice, orderIds: new Set<string>() };
                    if (orderId) entry.orderIds.add(orderId);
                    invoiceMap.set(invoiceId, entry);
                });

                for (const entry of invoiceMap.values()) {
                    const inv = entry.invoice;
                    const invoiceTotal = Number(inv.total || 0);
                    const amount = Number(inv.amount_paid) > 0 ? Number(inv.amount_paid) : invoiceTotal;
                    totalCash += amount;
                    details.push({
                        order_id: Array.from(entry.orderIds)[0] || null,
                        invoice_number: inv.invoice_number,
                        amount,
                        order_ids: Array.from(entry.orderIds)
                    });
                }
            }
        }

        // Finance source of truth for driver settlement.
        const driverUser = await User.findByPk(userId, {
            attributes: ['id', 'name', 'debt']
        });
        const debtFromFinance = Number(driverUser?.debt || 0);

        res.json({
            driver_id: userId,
            // Keep backward compatibility: frontend reads cash_on_hand.
            // This now follows Finance debt value so numbers match Finance dashboard.
            cash_on_hand: debtFromFinance,
            debt: debtFromFinance,
            cod_pending_calculated: totalCash,
            orders: details
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching wallet', error });
    }
};

