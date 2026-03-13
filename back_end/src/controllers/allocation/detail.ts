import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getOrderDetails = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name', 'email', 'whatsapp_number'] },
                {
                    model: OrderItem,
                    include: [{ model: Product, attributes: ['id', 'name', 'sku', 'stock_quantity', 'allocated_quantity'] }]
                },
                { model: OrderAllocation, as: 'Allocations' }
            ]
        });

        if (!order) {
            throw new CustomError('Order not found', 404);
        }
        res.json(order);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Internal server error', 500);
    }
});
