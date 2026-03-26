import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting, OrderEvent } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId, findOrderByIdOrInvoiceId } from '../../utils/invoiceLookup';
import { withOrderTrackingFields } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { isOrderTransitionAllowed, resolveLegacyOrderStatusAlias } from '../../utils/orderTransitions';
import { enqueueWhatsappNotification } from '../../services/TransactionNotificationOutboxService';
import { computeInvoiceNetTotals, computeInvoiceNetTotalsBulk } from '../../utils/invoiceNetTotals';
import { recordOrderStatusChanged } from '../../utils/orderEvent';

export const getMyOrders = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const includeCollectibleTotals = String((req.query as any)?.include_collectible_total || '') === 'true';

    const whereClause: any = { customer_id: userId };
    if (status) {
        whereClause.status = resolveLegacyOrderStatusAlias(status, 'customer_order_status_query');
    }

    const orders = await Order.findAndCountAll({
        where: whereClause,
        attributes: [
            'id',
            'customer_id',
            'customer_name',
            'source',
            'status',
            'payment_method',
            'total_amount',
            'discount_amount',
            'shipping_method_code',
            'shipping_method_name',
            'shipping_fee',
            'shipping_address',
            'customer_note',
            'courier_id',
            'expiry_date',
            'delivery_proof_url',
            'createdAt',
            'updatedAt'
        ],
        include: [
            { model: Retur, attributes: ['id', 'status'] },
            { model: OrderItem, attributes: ['qty', 'ordered_qty_original', 'qty_canceled_backorder'] },
            { model: OrderAllocation, as: 'Allocations', attributes: ['allocated_qty', 'status'] }
        ],
        limit: Number(limit),
        offset: Number(offset),
        order: [['createdAt', 'DESC']]
    });

    const plainOrders = orders.rows.map((row) => {
        const plain = row.get({ plain: true }) as any;
        const total_qty = (plain.OrderItems || []).reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0);
        const original_total_qty = (plain.OrderItems || []).reduce((sum: number, item: any) => sum + Number(item.ordered_qty_original || item.qty || 0), 0);
        const canceled_qty = (plain.OrderItems || []).reduce((sum: number, item: any) => sum + Number(item.qty_canceled_backorder || 0), 0);
        const status = String(plain.status || '').toLowerCase();
        const deliveredLikeStatus = ['shipped', 'delivered', 'completed'].includes(status);
        const allocated_qty = (plain.Allocations || []).reduce(
            (sum: number, alloc: any) => sum + Number(alloc.allocated_qty || 0),
            0
        );
        const shipped_qty = deliveredLikeStatus
            ? Math.min(total_qty, allocated_qty > 0 ? allocated_qty : total_qty)
            : 0;
        const indent_qty = Math.max(0, total_qty - shipped_qty);

        return {
            ...plain,
            total_qty,
            original_total_qty,
            canceled_qty,
            shipped_qty,
            indent_qty
        };
    });

    const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);
    let enrichedOrders = ordersWithInvoices;
    if (includeCollectibleTotals) {
        const invoiceIds = new Set<string>();
        ordersWithInvoices.forEach((row: any) => {
            const inv = row?.Invoice;
            if (inv?.id) invoiceIds.add(String(inv.id));
            const list = Array.isArray(row?.Invoices) ? row.Invoices : [];
            list.forEach((i: any) => { if (i?.id) invoiceIds.add(String(i.id)); });
        });
        const ids = Array.from(invoiceIds).filter(Boolean);
        const totalsByInvoiceId = ids.length > 0 ? await computeInvoiceNetTotalsBulk(ids) : new Map<string, any>();

        enrichedOrders = ordersWithInvoices.map((row: any) => {
            const attach = (inv: any) => {
                if (!inv?.id) return inv;
                const computed = totalsByInvoiceId.get(String(inv.id));
                if (!computed) return inv;
                return {
                    ...inv,
                    collectible_total: Number(computed.net_total || 0),
                    delivery_return_summary: computed
                };
            };
            return {
                ...row,
                Invoice: row?.Invoice ? attach(row.Invoice) : row?.Invoice || null,
                Invoices: Array.isArray(row?.Invoices) ? row.Invoices.map((i: any) => attach(i)) : row?.Invoices || []
            };
        });
    }

    res.json({
        total: orders.count,
        totalPages: Math.ceil(orders.count / Number(limit)),
        currentPage: Number(page),
        orders: enrichedOrders
    });
});

export const getOrderDetails = asyncWrapper(async (req: Request, res: Response) => {
    const { id } = req.params;
    const orderId = String(id);
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const whereClause: any = { id: orderId };

    // Customers can only see their own orders
    if (userRole === 'customer') {
        whereClause.customer_id = userId;
    }

    const productAttributes = userRole === 'customer'
        ? ['name', 'sku', 'unit']
        : ['name', 'sku', 'unit', 'stock_quantity', 'allocated_quantity'];

    const orderAttributes = userRole === 'customer'
        ? [
            'id',
            'customer_id',
            'customer_name',
            'source',
            'status',
            'payment_method',
            'total_amount',
            'discount_amount',
            'shipping_method_code',
            'shipping_method_name',
            'shipping_fee',
            'shipping_address',
            'customer_note',
            'courier_id',
            'expiry_date',
            'delivery_proof_url',
            'createdAt',
            'updatedAt',
            'stock_released',
            'parent_order_id',
            'goods_out_posted_at',
            'goods_out_posted_by',
        ]
        : undefined;

    const orderItemAttributes = userRole === 'customer'
        ? ['id', 'order_id', 'product_id', 'qty', 'ordered_qty_original', 'qty_canceled_backorder', 'price_at_purchase']
        : ['id', 'order_id', 'product_id', 'qty', 'ordered_qty_original', 'qty_canceled_backorder', 'price_at_purchase', 'cost_at_purchase', 'pricing_snapshot'];

    let targetOrderId = orderId;
    const directOrder = await Order.findOne({
        where: whereClause,
        attributes: ['id']
    });
    if (!directOrder) {
        const resolvedOrder = await findOrderByIdOrInvoiceId(orderId);
        if (!resolvedOrder) {
            throw new CustomError('Order not found', 404);
        }
        targetOrderId = String(resolvedOrder.id || '');
    }

    const order = await Order.findOne({
        where: userRole === 'customer'
            ? { id: targetOrderId, customer_id: userId }
            : { id: targetOrderId },
        ...(orderAttributes ? { attributes: orderAttributes } : {}),
        include: [
            { model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number', 'email'] },
            { model: User, as: 'Courier', attributes: ['id', 'name', 'role', 'whatsapp_number'] },
            { model: OrderIssue, as: 'Issues', where: { status: 'open' }, required: false },
            { model: OrderItem, attributes: orderItemAttributes, include: [{ model: Product, attributes: productAttributes }] },
            { model: OrderAllocation, as: 'Allocations' },
            { model: Order, as: 'Children' },
            { model: Retur }
        ]
    });

    if (!order) {
        throw new CustomError('Order details not found', 404);
    }
    const plainOrder = order.get({ plain: true }) as any;
    const [orderWithInvoices] = await attachInvoicesToOrders([plainOrder]);
    const trackedOrder = withOrderTrackingFields(orderWithInvoices);

    const orderItems = Array.isArray(trackedOrder?.OrderItems) ? trackedOrder.OrderItems : [];
    const allocations = Array.isArray(trackedOrder?.Allocations) ? trackedOrder.Allocations : [];
    const allocatedByProduct = allocations.reduce((acc: Record<string, number>, allocation: any) => {
        const productId = String(allocation?.product_id || '').trim();
        if (!productId) return acc;
        acc[productId] = Number(acc[productId] || 0) + Number(allocation?.allocated_qty || 0);
        return acc;
    }, {});
    const itemsByProduct = new Map<string, any[]>();
    orderItems.forEach((item: any) => {
        const productId = String(item?.product_id || '').trim();
        if (!productId) return;
        const rows = itemsByProduct.get(productId) || [];
        rows.push(item);
        itemsByProduct.set(productId, rows);
    });

    const allocatedByItemId: Record<string, number> = {};
    itemsByProduct.forEach((rows, productId) => {
        let remaining = Number(allocatedByProduct[productId] || 0);
        const sortedRows = [...rows].sort((a: any, b: any) => String(a?.id || '').localeCompare(String(b?.id || '')));
        sortedRows.forEach((row: any) => {
            const itemId = String(row?.id || '');
            const activeQty = Math.max(0, Number(row?.qty || 0));
            const allocatedQty = Math.max(0, Math.min(remaining, activeQty));
            allocatedByItemId[itemId] = allocatedQty;
            remaining = Math.max(0, remaining - allocatedQty);
        });
    });

    const orderItemIds = orderItems.map((item: any) => String(item?.id || '')).filter(Boolean);
    const invoiceItems = orderItemIds.length > 0
        ? await InvoiceItem.findAll({
            where: { order_item_id: { [Op.in]: orderItemIds } },
            attributes: ['order_item_id', 'qty']
        })
        : [];
    const invoicedByItemId: Record<string, number> = {};
    invoiceItems.forEach((row: any) => {
        const itemId = String(row?.order_item_id || '');
        if (!itemId) return;
        invoicedByItemId[itemId] = Number(invoicedByItemId[itemId] || 0) + Number(row?.qty || 0);
    });

    const itemSummaries = orderItems.map((item: any) => {
        const itemId = String(item?.id || '');
        const orderedQtyOriginal = Math.max(0, Number(item?.ordered_qty_original || item?.qty || 0));
        const allocatedQtyTotal = Math.max(0, Number(allocatedByItemId[itemId] || 0));
        const invoicedQtyTotal = Math.max(0, Number(invoicedByItemId[itemId] || 0));
        const orderStatus = String(trackedOrder?.status || '').trim().toLowerCase();
        const backorderCanceledQtyBase = Math.max(0, Number(item?.qty_canceled_backorder || 0));
        // For legacy data, some canceled orders didn't write qty_canceled_backorder.
        // Treat remaining qty as canceled so UI doesn't show "Backorder Aktif" on canceled orders.
        const inferredCanceledOnFullCancel = orderStatus === 'canceled'
            ? Math.max(0, orderedQtyOriginal - allocatedQtyTotal)
            : 0;
        const backorderCanceledQty = Math.max(backorderCanceledQtyBase, inferredCanceledOnFullCancel);
        const backorderOpenQty = orderStatus === 'canceled'
            ? 0
            : Math.max(0, orderedQtyOriginal - allocatedQtyTotal - backorderCanceledQty);
        return {
            order_item_id: itemId,
            ordered_qty_original: orderedQtyOriginal,
            allocated_qty_total: allocatedQtyTotal,
            invoiced_qty_total: invoicedQtyTotal,
            backorder_open_qty: backorderOpenQty,
            backorder_canceled_qty: backorderCanceledQty,
        };
    });

    const events = await OrderEvent.findAll({
        where: { order_id: String(order.id) },
        order: [['occurred_at', 'ASC'], ['createdAt', 'ASC']]
    });
    const timeline = events.map((evt: any) => {
        const plain = evt.get({ plain: true }) as any;
        return {
            id: String(plain?.id || ''),
            event_type: String(plain?.event_type || ''),
            order_item_id: plain?.order_item_id ? String(plain.order_item_id) : null,
            invoice_id: plain?.invoice_id ? String(plain.invoice_id) : null,
            reason: plain?.reason || null,
            actor_role: plain?.actor_role || null,
            occurred_at: plain?.occurred_at || plain?.createdAt || null,
            payload: plain?.payload || null,
        };
    });

    const inferredInvoiceId = String((trackedOrder as any)?.Invoice?.id || '').trim();
    let deliveryReturnSummary: any = null;
    if (inferredInvoiceId) {
        try {
            deliveryReturnSummary = await computeInvoiceNetTotals(inferredInvoiceId);
        } catch {
            deliveryReturnSummary = null;
        }
    }
    const returs = Array.isArray((trackedOrder as any)?.Returs) ? (trackedOrder as any).Returs : [];
    const deliveryReturs = returs.filter((r: any) =>
        ['delivery_refusal', 'delivery_damage'].includes(String(r?.retur_type || ''))
        && String(r?.status || '') !== 'rejected'
    );

    res.json({
        ...trackedOrder,
        item_summaries: itemSummaries,
        timeline,
        delivery_returs: deliveryReturs,
        delivery_return_summary: deliveryReturnSummary,
    });
});

export const uploadPaymentProof = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const orderId = String(id);
        const requestedInvoiceId = String(req.body?.invoice_id || '').trim();
        const userId = req.user!.id;
        const file = req.file;

        if (!file) {
            await t.rollback();
            throw new CustomError('No file uploaded', 400);
        }

        const order = await Order.findOne({
            where: { id: orderId, customer_id: userId },
            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            throw new CustomError('Order not found', 404);
        }

        let invoice = null;
        if (requestedInvoiceId) {
            const targetInvoice = await Invoice.findByPk(requestedInvoiceId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!targetInvoice) {
                await t.rollback();
                throw new CustomError('Invoice not found', 404);
            }
            const relatedOrderIds = await findOrderIdsByInvoiceId(requestedInvoiceId, { transaction: t });
            if (!relatedOrderIds.includes(orderId)) {
                await t.rollback();
                throw new CustomError('Invoice tidak terkait dengan order ini', 400);
            }
            if (String(targetInvoice.customer_id || '') !== String(userId)) {
                await t.rollback();
                throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
            }
            invoice = targetInvoice;
        } else {
            invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        }
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice not found', 404);
        }

        if (String(order.payment_method || '').trim().toLowerCase() !== 'transfer_manual') {
            await t.rollback();
            throw new CustomError('Metode pembayaran order sudah berubah. Bukti transfer tidak dapat diunggah.', 409);
        }

        if (String(invoice.payment_method || '').trim().toLowerCase() !== 'transfer_manual') {
            await t.rollback();
            throw new CustomError('Bukti transfer hanya berlaku untuk invoice transfer manual.', 400);
        }

        const latestInvoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        if (latestInvoice && String(latestInvoice.id) !== String(invoice.id)) {
            await t.rollback();
            throw new CustomError('Invoice ini sudah digantikan oleh invoice yang lebih baru. Bukti transfer tidak dapat diunggah.', 409);
        }

        if (invoice.payment_status === 'paid') {
            await t.rollback();
            throw new CustomError('Pesanan sudah dibayar.', 400);
        }

        if (invoice.payment_proof_url) {
            await t.rollback();
            throw new CustomError('Bukti transfer sudah diunggah dan sedang dalam verifikasi.', 400);
        }

        // In real app, upload to S3/Cloudinary and get URL. 
        // Here we store the local path or filename.
        await invoice.update({
            payment_proof_url: file.path,
            // Keep unpaid until admin_finance verifies transfer.
            payment_status: 'unpaid',
            verified_by: null,
            verified_at: null,
        }, { transaction: t });

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (relatedOrderIds.length === 0) {
            relatedOrderIds.push(String(order.id));
        }

        const nextStatus = 'waiting_admin_verification';
        const ordersToUpdate = await Order.findAll({
            where: { id: { [Op.in]: relatedOrderIds }, customer_id: userId },
            attributes: ['id', 'status', 'source', 'courier_id'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (ordersToUpdate.length === 0) {
            await t.rollback();
            throw new CustomError('Invoice tidak memiliki order terkait untuk akun ini.', 403);
        }
        const previousStatusByOrderId: Record<string, string> = {};
        for (const row of ordersToUpdate as any[]) {
            const currentStatus = String(row?.status || '').toLowerCase();
            previousStatusByOrderId[String(row?.id || '')] = String(row?.status || '');
            if (!isOrderTransitionAllowed(currentStatus, nextStatus)) {
                await t.rollback();
                throw new CustomError(
                    `Order ${String(row?.id || '')} tidak bisa masuk status ${nextStatus} dari status '${currentStatus}'.`,
                    409
                );
            }
        }

        await Order.update(
            { status: nextStatus },
            { where: { id: { [Op.in]: ordersToUpdate.map((row) => String((row as any)?.id || '')).filter(Boolean) }, customer_id: userId }, transaction: t }
        );
        // After upload, status becomes waiting_admin_verification until finance approves.

        const changedOrderIds = ordersToUpdate
            .map((row: any) => String(row?.id || ''))
            .filter((orderId: string) => Boolean(orderId) && previousStatusByOrderId[orderId] !== nextStatus);

        if (changedOrderIds.length === 0) {
            await emitAdminRefreshBadges({
                transaction: t,
                requestContext: 'order_payment_proof_refresh_badges'
            });
        } else {
            for (const row of ordersToUpdate as any[]) {
                const orderId = String(row?.id || '');
                if (!orderId) continue;
                const prev = previousStatusByOrderId[orderId] || '';
                if (prev === nextStatus) continue;
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: orderId,
                    invoice_id: String(invoice.id || ''),
                    from_status: prev || null,
                    to_status: nextStatus,
                    actor_user_id: String(userId),
                    actor_role: String(req.user?.role || 'customer'),
                    reason: 'order_payment_proof_upload',
                });
                await emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: prev || null,
                    to_status: nextStatus,
                    source: String(row?.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(row?.courier_id || ''),
                    triggered_by_role: String(req.user?.role || 'customer'),
                    target_roles: ['admin_finance', 'customer'],
                }, {
                    transaction: t,
                    requestContext: `order_payment_proof_status_changed:${invoice.id}:${orderId}`
                });
            }
        }

        await t.commit();

        (async () => {
            try {
                const customerMsg = `[Migunani Motor] Bukti pembayaran untuk pesanan #${order.id} telah kami terima. Pembayaran Anda akan segera diverifikasi oleh tim finance kami. Terima kasih!`;
                // @ts-ignore
                const customerWaRaw = order.Customer?.whatsapp_number || (order as any).whatsapp_number;
                const customerWa = customerWaRaw ? String(customerWaRaw).trim() : '';
                await enqueueWhatsappNotification({
                    target: customerWa,
                    textBody: customerMsg,
                    requestContext: `order_payment_proof_customer:${order.id}`
                });

                // Notify Finance Admins
                const financeAdmins = await User.findAll({ where: { role: 'admin_finance', status: 'active' } });
                const adminMsg = `[PEMBAYARAN] Bukti transfer baru diunggah untuk Invoice ${invoice.invoice_number || order.id}.\nCustomer: ${order.customer_name || 'Customer'}\nSilakan verifikasi di panel admin.`;

                for (const admin of financeAdmins) {
                    await enqueueWhatsappNotification({
                        target: String(admin.whatsapp_number || '').trim(),
                        textBody: adminMsg,
                        requestContext: `order_payment_proof_finance:${order.id}:${admin.id}`
                    });
                }
            } catch (notifError) {
                console.error('[WA_NOTIFY_OUTBOX_ENQUEUE_UNEXPECTED]', notifError);
            }
        })();

        res.json({ message: 'Payment proof uploaded' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
