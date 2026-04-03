import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem, Backorder } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { OrderTerminalizationService } from '../../services/OrderTerminalizationService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findDriverInvoiceContextByOrderOrInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isOrderTransitionAllowed } from '../../utils/orderTransitions';
import { computeInvoiceNetTotals } from '../../utils/invoiceNetTotals';
import { recordOrderStatusChanged } from '../../utils/orderEvent';

const parseBatchIds = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
        return raw.map((v) => String(v || '').trim()).filter(Boolean);
    }
    if (typeof raw !== 'string') return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map((v) => String(v || '').trim()).filter(Boolean);
            }
        } catch {
            // fallthrough
        }
    }
    return trimmed.split(',').map((v) => String(v || '').trim()).filter(Boolean);
};

const completeSingleDeliveryInternal = async (
    id: string,
    params: { userId: string; userRole: string; file?: Express.Multer.File },
    options: { transaction: any; context?: { invoice: any; orders: any[] } }
): Promise<{ invoice_id: string; affected_order_ids: string[] }> => {
    const t = options.transaction;
    const context = options.context ?? await findDriverInvoiceContextByOrderOrInvoiceId(String(id), params.userId, {
        transaction: t,
        lock: t.LOCK.UPDATE
    });
    const invoice = context?.invoice;
    const contextOrders = Array.isArray(context?.orders) ? context.orders : [];
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

    if (paymentMethod === 'cod' && !isZeroDue && ['unpaid', 'draft'].includes(paymentStatus)) {
        throw new CustomError(
            'Pembayaran COD wajib dicatat (terima uang) sebelum menyelesaikan pengiriman.',
            409
        );
    }
    if (!params.file && !isFullReturnAllItems) {
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
            await AccountingPostingService.postGoodsOutForOrder(String(order.id), String(params.userId), t, 'cod');
        }

        const updatePayload: any = { status: nextOrderStatus };
        if (params.file) {
            updatePayload.delivery_proof_url = params.file.path;
        }
        await order.update(updatePayload, { transaction: t });
        if (nextOrderStatus === 'completed') {
            await OrderTerminalizationService.releaseReservationsForOrders({
                order_ids: [String(order.id)],
                transaction: t,
                context: 'driver_complete_delivery',
            });
        }
        await recordOrderStatusChanged({
            transaction: t,
            order_id: String(order.id),
            invoice_id: String(invoice.id || ''),
            from_status: previousOrderStatus,
            to_status: nextOrderStatus,
            actor_user_id: String(params.userId),
            actor_role: params.userRole,
            reason: 'driver_complete_delivery',
        });
        affectedOrderIds.push(String(order.id));

        await emitOrderStatusChanged({
            order_id: String(order.id),
            from_status: previousOrderStatus,
            to_status: nextOrderStatus,
            source: String(order.source || ''),
            payment_method: String(invoice.payment_method || ''),
            courier_id: String(order.courier_id || params.userId),
            triggered_by_role: params.userRole,
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
        ...(params.file ? { delivery_proof_url: params.file.path } : {})
    }, { transaction: t });

    return { invoice_id: String(invoice.id), affected_order_ids: affectedOrderIds };
};

export const completeDelivery = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID or Invoice ID
        const userId = String(req.user!.id);
        const userRole = String(req.user?.role || 'driver');
        const file = req.file; // Uploaded proof

        const result = await completeSingleDeliveryInternal(String(id), { userId, userRole, file }, { transaction: t });
        await t.commit();
        return res.json({
            message: `Delivery marked delivered for ${result.affected_order_ids.length} order(s)`,
            affected_order_ids: result.affected_order_ids,
            completed_order_count: result.affected_order_ids.length
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error completing delivery', 500);
    }
});

export const completeDeliveryBatch = asyncWrapper(async (req: Request, res: Response) => {
    const ids = parseBatchIds((req.body as any)?.ids ?? (req.body as any)?.invoice_ids ?? (req.body as any)?.invoiceIds);
    const uniqueIds = Array.from(new Set(ids.map((v) => String(v || '').trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
        throw new CustomError('ids wajib diisi (minimal 1).', 400);
    }
    if (uniqueIds.length > 30) {
        throw new CustomError('Terlalu banyak invoice dalam sekali proses (maksimal 30).', 400);
    }

    const t = await sequelize.transaction();
    try {
        const userId = String(req.user!.id);
        const userRole = String(req.user?.role || 'driver');
        const file = req.file;

        const processedInvoiceIds = new Set<string>();
        const affectedOrderIds = new Set<string>();
        const results: Array<{ input_id: string; invoice_id: string; affected_order_ids: string[] }> = [];
        const skipped: Array<{ input_id: string; reason: string; invoice_id?: string }> = [];

        for (const inputId of uniqueIds) {
            const context = await findDriverInvoiceContextByOrderOrInvoiceId(String(inputId), userId, {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const invoice = (context as any)?.invoice || null;
            const invId = String(invoice?.id || '').trim();
            if (invId && processedInvoiceIds.has(invId)) {
                skipped.push({ input_id: inputId, invoice_id: invId, reason: 'duplicate_invoice' });
                continue;
            }

            const result = await completeSingleDeliveryInternal(String(inputId), { userId, userRole, file }, { transaction: t, context });
            const doneInvoiceId = String(result.invoice_id || '').trim();
            if (doneInvoiceId) processedInvoiceIds.add(doneInvoiceId);
            result.affected_order_ids.forEach((oid) => affectedOrderIds.add(String(oid)));
            results.push({ input_id: inputId, invoice_id: doneInvoiceId, affected_order_ids: result.affected_order_ids });
        }

        await t.commit();
        return res.json({
            message: `Delivery batch marked delivered for ${processedInvoiceIds.size} invoice(s)`,
            invoice_count: processedInvoiceIds.size,
            invoice_ids: Array.from(processedInvoiceIds),
            affected_order_ids: Array.from(affectedOrderIds),
            results,
            skipped,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error completing delivery batch', 500);
    }
});
