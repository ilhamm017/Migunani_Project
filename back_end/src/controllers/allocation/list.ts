import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
import { buildShortageSummary, TERMINAL_ORDER_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getPendingAllocations = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const scope = String(req.query?.scope || 'shortage').toLowerCase();
        const includeAllOpenOrders = scope === 'all';

        const orders = await Order.findAll({
            where: {
                status: { [Op.notIn]: TERMINAL_ORDER_STATUSES as unknown as string[] }
            },
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name'] },
                {
                    model: OrderItem,
                    include: [
                        { model: Product, attributes: ['id', 'name', 'sku', 'base_price', 'stock_quantity', 'allocated_quantity'] },
                        { model: Backorder, attributes: ['id', 'qty_pending', 'status'], required: false },
                    ]
                },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            order: [['createdAt', 'ASC']] // FIFO
        });

        const rows = orders
            .map((order: any) => {
                const plain = order.get({ plain: true });
                const { orderedTotal, allocatedTotal, shortageTotal, shortageItems } = buildShortageSummary(plain.OrderItems, plain.Allocations);
                const needsAllocation = shortageTotal > 0;
                const orderItems = Array.isArray(plain.OrderItems) ? plain.OrderItems : [];
                const hasActiveBackorderRecord = orderItems.some((oi: any) => {
                    const bo = (oi as any)?.Backorder;
                    return bo && Number(bo.qty_pending || 0) > 0 && String(bo.status || '') === 'waiting_stock';
                });
                const fulfillmentLabel = !needsAllocation
                    ? 'fulfilled'
                    : (hasActiveBackorderRecord ? (allocatedTotal > 0 ? 'backorder' : 'preorder') : 'unallocated');

                return {
                    ...plain,
                    ordered_total: orderedTotal,
                    allocated_total: allocatedTotal,
                    shortage_total: shortageTotal,
                    needs_allocation: needsAllocation,
                    has_active_backorder_record: hasActiveBackorderRecord,
                    is_backorder: fulfillmentLabel === 'backorder',
                    status_label: fulfillmentLabel,
                    shortage_items: shortageItems,
                };
            })
            .filter((row: any) => includeAllOpenOrders || row.needs_allocation);

        res.json({
            scope: includeAllOpenOrders ? 'all' : 'shortage',
            rows,
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Internal server error', 500);
    }
});

export const getProductAllocations = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { productId } = req.params as { productId: string };
        if (!productId || !String(productId).trim()) {
            throw new CustomError('productId wajib diisi', 400);
        }

        const allocations = await OrderAllocation.findAll({
            where: {
                product_id: productId,
                allocated_qty: { [Op.gt]: 0 }
            },
            include: [
                {
                    model: Order,
                    attributes: ['id', 'status', 'customer_name', 'createdAt'],
                    include: [
                        { model: User, as: 'Customer', attributes: ['id', 'name'], required: false },
                    ],
                    required: false
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        const orderMap = new Map<string, any>();
        allocations.forEach((item: any) => {
            const order = item.Order;
            if (order) orderMap.set(String(order.id), order);
        });
        const ordersWithInvoices = await attachInvoicesToOrders(
            Array.from(orderMap.values()).map((order: any) => order.get({ plain: true }) as any)
        );
        const invoiceByOrderId = new Map<string, any>();
        ordersWithInvoices.forEach((order: any) => {
            invoiceByOrderId.set(String(order.id), order.Invoice || null);
        });

        const closedOrderStatuses = new Set(['completed', 'canceled', 'expired']);

        const rows = allocations.map((item: any) => {
            const order = item.Order;
            const customerName = order?.Customer?.name || order?.customer_name || 'Customer';
            const orderStatus = String(order?.status || '').toLowerCase();
            const invoice = invoiceByOrderId.get(String(order?.id || '')) || null;

            return {
                allocation_id: item.id,
                allocated_qty: Number(item.allocated_qty || 0),
                allocation_status: item.status,
                order_id: order?.id || null,
                order_status: order?.status || null,
                order_created_at: order?.createdAt || null,
                customer_name: customerName,
                invoice_number: invoice?.invoice_number || null,
                payment_status: invoice?.payment_status || null,
                is_order_open: orderStatus ? !closedOrderStatuses.has(orderStatus) : true,
            };
        });

        const totalAllocated = rows.reduce((sum: number, row: any) => sum + Number(row.allocated_qty || 0), 0);
        const openAllocated = rows
            .filter((row: any) => row.is_order_open)
            .reduce((sum: number, row: any) => sum + Number(row.allocated_qty || 0), 0);

        return res.json({
            product_id: productId,
            total_allocated: totalAllocated,
            open_allocated: openAllocated,
            order_count: rows.length,
            rows
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Internal server error', 500);
    }
});
