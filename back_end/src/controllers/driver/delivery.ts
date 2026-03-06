import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';

export const completeDelivery = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const userId = req.user!.id;
        const file = req.file; // Uploaded proof

        // Check ownership
        const order = await Order.findOne({
            where: { id, courier_id: userId }
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found or not assigned to you' });
        }

        const invoice = await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice missing' });
        }
        const previousOrderStatus = String(order.status || '');

        if (invoice.payment_method === 'cod') {
            await AccountingPostingService.postGoodsOutForOrder(order.id, String(userId), t, 'cod');
        }

        const paymentMethod = String(invoice.payment_method || '').toLowerCase();
        const paymentStatus = String(invoice.payment_status || '').toLowerCase();
        const nextOrderStatus =
            (paymentMethod === 'cod' && paymentStatus === 'cod_pending')
                || (paymentMethod === 'transfer_manual' && paymentStatus === 'paid')
                || (paymentMethod === 'cash_store' && paymentStatus === 'paid')
                ? 'completed'
                : 'delivered';

        // Save delivery proof photo to order (separate from payment proof)
        const updatePayload: any = { status: nextOrderStatus };
        if (file) {
            updatePayload.delivery_proof_url = file.path;
        }
        await order.update(updatePayload, { transaction: t });

        await t.commit();
        emitOrderStatusChanged({
            order_id: String(order.id),
            from_status: previousOrderStatus,
            to_status: nextOrderStatus,
            source: String(order.source || ''),
            payment_method: String(invoice.payment_method || ''),
            courier_id: String(order.courier_id || userId),
            triggered_by_role: String(req.user?.role || 'driver'),
            target_roles: nextOrderStatus === 'completed' ? ['admin_finance', 'customer'] : ['admin_finance'],
        });
        res.json({ message: `Delivery ${nextOrderStatus === 'completed' ? 'completed' : 'marked delivered'}` });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error completing delivery', error });
    }
};

