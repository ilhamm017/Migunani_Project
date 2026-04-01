import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem, Backorder } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findDriverInvoiceContextByOrderOrInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { computeInvoiceNetTotals } from '../../utils/invoiceNetTotals';
import { recordOrderStatusChanged } from '../../utils/orderEvent';

export const completeDelivery = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID or Invoice ID
        const userId = req.user!.id;
        const file = req.file; // Uploaded proof

        const context = await findDriverInvoiceContextByOrderOrInvoiceId(String(id), userId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const invoice = context.invoice;
        const contextOrders = context.orders;
        if (!invoice || contextOrders.length === 0) {
            throw new CustomError('Order atau invoice tidak ditemukan atau tidak ditugaskan ke driver ini.', 404);
        }

        const invoiceShipmentStatus = String(invoice.shipment_status || '').trim().toLowerCase();
        if (invoiceShipmentStatus === 'delivered' || Boolean((invoice as any).delivered_at || invoice.delivered_at)) {
            throw new CustomError('Invoice ini sudah selesai dikirim.', 409);
        }

        const paymentMethod = String(invoice.payment_method || '').toLowerCase();
        const paymentStatus = String(invoice.payment_status || '').toLowerCase();
        const computedTotals = await computeInvoiceNetTotals(String(invoice.id), { transaction: t });
        const computedNetTotal = Number(computedTotals?.net_total || 0);
        const isZeroDue = Number.isFinite(computedNetTotal) && computedNetTotal <= 0.01;
        const oldItemsSubtotal = Number(computedTotals?.old_items_subtotal ?? Number.NaN);
        const newItemsSubtotal = Number(computedTotals?.new_items_subtotal ?? Number.NaN);
        const isFullReturnAllItems =
            Number.isFinite(oldItemsSubtotal)
            && oldItemsSubtotal > 0.01
            && Number.isFinite(newItemsSubtotal)
            && newItemsSubtotal <= 0.01;
        if (!file && !isFullReturnAllItems) {
            throw new CustomError('Bukti foto pengiriman wajib diupload sebelum menyelesaikan pengiriman.', 400);
        }
        const affectedOrderIds: string[] = [];

        const openOrders = contextOrders.filter((order: any) => {
            const current = String(order?.status || '').trim().toLowerCase();
            return !FINAL_ORDER_STATUSES.has(current);
        });
        if (openOrders.length === 0) {
            throw new CustomError('Semua order pada invoice ini sudah selesai diproses.', 409);
        }

        for (const order of openOrders) {
            const previousOrderStatus = String(order.status || '');
            const orderItems = await OrderItem.findAll({
                where: { order_id: String(order.id) },
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

            let nextOrderStatus =
                isZeroDue
                    ? 'completed'
                    : (paymentMethod === 'cod' && paymentStatus === 'cod_pending')
                    || (paymentMethod === 'transfer_manual' && paymentStatus === 'paid')
                    || (paymentMethod === 'cash_store' && paymentStatus === 'paid')
                    ? 'completed'
                    : 'delivered';
            if (openBackorderCount > 0) {
                nextOrderStatus = 'partially_fulfilled';
            }
            if (!isOrderTransitionAllowed(previousOrderStatus, nextOrderStatus)) {
                throw new CustomError(`Transisi status tidak diizinkan: '${previousOrderStatus}' -> '${nextOrderStatus}'`, 409);
            }

            if (paymentMethod === 'cod') {
                await AccountingPostingService.postGoodsOutForOrder(String(order.id), String(userId), t, 'cod');
            }

            const updatePayload: any = { status: nextOrderStatus };
            if (file) {
                updatePayload.delivery_proof_url = file.path;
            }
            await order.update(updatePayload, { transaction: t });
            await recordOrderStatusChanged({
                transaction: t,
                order_id: String(order.id),
                invoice_id: String(invoice.id || ''),
                from_status: previousOrderStatus,
                to_status: nextOrderStatus,
                actor_user_id: String(userId),
                actor_role: String(req.user?.role || 'driver'),
                reason: 'driver_complete_delivery',
            });
            affectedOrderIds.push(String(order.id));

            await emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: previousOrderStatus,
                to_status: nextOrderStatus,
                source: String(order.source || ''),
                payment_method: String(invoice.payment_method || ''),
                courier_id: String(order.courier_id || userId),
                triggered_by_role: String(req.user?.role || 'driver'),
                target_roles: nextOrderStatus === 'completed'
                    ? ['admin_finance', 'customer']
                    : (nextOrderStatus === 'partially_fulfilled'
                        ? ['admin_finance', 'customer', 'kasir', 'admin_gudang']
                        : ['admin_finance']),
            }, {
                transaction: t,
                requestContext: 'driver_complete_delivery_status_changed'
            });
        }

        if (isZeroDue && paymentStatus !== 'paid') {
            await invoice.update({
                payment_status: 'paid',
                amount_paid: 0,
                change_amount: 0,
                verified_at: new Date(),
                verified_by: null,
            }, { transaction: t });
        }

        await invoice.update({
            shipment_status: 'delivered',
            delivered_at: new Date(),
            ...(file ? { delivery_proof_url: file.path } : {})
        }, { transaction: t });
        await t.commit();
        res.json({
            message: `Delivery marked delivered for ${affectedOrderIds.length} order(s)`,
            affected_order_ids: affectedOrderIds,
            completed_order_count: affectedOrderIds.length
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error completing delivery', 500);
    }
});
