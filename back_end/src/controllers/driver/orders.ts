import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getAssignedOrders = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id; // Driver ID
        const { status, startDate, endDate } = req.query;
        const requestedStatuses = String(status || '')
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean);

        const whereClause: any = { courier_id: userId };

        // If status specified, filter. Else show active deliveries?
        if (status) {
            const statusStr = String(status);
            if (statusStr.includes(',')) {
                whereClause.status = { [Op.in]: statusStr.split(',').map(s => s.trim()) };
            } else {
                whereClause.status = status;
            }
        } else {
            // Default: Show only actionable or pending tasks.
            // Exclude 'completed' to avoid showing history in active task counts/badges.
            whereClause.status = { [Op.in]: ['ready_to_ship', 'shipped', 'delivered'] };
        }

        if (startDate || endDate) {
            const dateFilter: any = {};
            if (startDate) {
                const start = new Date(String(startDate));
                if (!Number.isNaN(start.getTime())) {
                    start.setHours(0, 0, 0, 0);
                    dateFilter[Op.gte] = start;
                }
            }
            if (endDate) {
                const end = new Date(String(endDate));
                if (!Number.isNaN(end.getTime())) {
                    end.setHours(23, 59, 59, 999);
                    dateFilter[Op.lte] = end;
                }
            }
            if (Object.keys(dateFilter).length > 0) {
                whereClause.updatedAt = dateFilter;
            }
        }

        const orders = await Order.findAll({
            where: whereClause,
            include: [
                { model: OrderItem, include: [Product] },
                {
                    model: User,
                    as: 'Customer',
                    include: [{ model: CustomerProfile }]
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const plainOrders = orders.map((order: any) => order.get({ plain: true }) as any);
        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        // Explode: One row per invoice. This is important for drivers to see
        // exactly which invoices they are delivering and how much they collected.
        const explodedOrders: any[] = [];
        ordersWithInvoices.forEach((order: any) => {
            const invoices = Array.isArray(order.Invoices) ? order.Invoices : [];
            const normalizedOrderStatus = String(order.status || '').trim().toLowerCase();
            const shouldOnlyShowLatestInvoice =
                COURIER_OWNERSHIP_REQUIRED_STATUSES.has(normalizedOrderStatus)
                || requestedStatuses.every((row) => COURIER_OWNERSHIP_REQUIRED_STATUSES.has(row));
            const visibleInvoices = shouldOnlyShowLatestInvoice
                ? invoices.slice(0, 1)
                : invoices;
            if (visibleInvoices.length > 0) {
                visibleInvoices.forEach((inv: any) => {
                    explodedOrders.push({
                        ...order,
                        id: inv.id, // Using Invoice ID as unique list key
                        real_order_id: order.id,
                        invoice_id: inv.id,
                        invoice_number: inv.invoice_number,
                        total_amount: inv.total, // Correctly show split invoice total
                        payment_status: inv.payment_status,
                        payment_method: inv.payment_method,
                        Invoice: inv,
                        Invoices: [inv]
                    });
                });
            } else {
                explodedOrders.push(order);
            }
        });

        res.json(explodedOrders);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching assigned orders', 500);
    }
});
