import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, OrderAllocation, Product, sequelize, User, OrderIssue, Backorder, InvoiceItem } from '../../models';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders } from '../../utils/invoiceLookup';
export const getOrderDetails = async (req: Request, res: Response) => {
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
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
