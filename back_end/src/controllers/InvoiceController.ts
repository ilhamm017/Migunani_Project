import { Request, Response } from 'express';
import { Invoice, InvoiceItem, OrderItem, Product, User, Order, sequelize } from '../models';
import { Op } from 'sequelize';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../utils/invoiceLookup';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { enqueueWhatsappNotification } from '../services/TransactionNotificationOutboxService';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { isOrderTransitionAllowed } from '../utils/orderTransitions';

export const getInvoiceDetail = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = String(req.params.id || '').trim();
    if (!invoiceId) {
        throw new CustomError('invoice id wajib diisi', 400);
    }

    const invoice = await Invoice.findByPk(invoiceId, {
        include: [
            {
                model: InvoiceItem,
                as: 'Items',
                attributes: ['id', 'qty', 'unit_price', 'line_total', 'order_item_id'],
                include: [
                    {
                        model: OrderItem,
                        attributes: ['id', 'order_id', 'product_id', 'qty', 'ordered_qty_original', 'qty_canceled_backorder'],
                        include: [{ model: Product, attributes: ['name', 'sku', 'unit'] }]
                    }
                ]
            }
        ]
    });

    if (!invoice) {
        throw new CustomError('Invoice tidak ditemukan', 404);
    }

    const user = req.user!;
    const userRole = String(user?.role || '');
    if (userRole === 'customer') {
        const customerId = String(invoice.getDataValue('customer_id') || '');
        if (!customerId || customerId !== String(user.id)) {
            throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
        }
    } else if (userRole === 'driver') {
        const orderIds = await findOrderIdsByInvoiceId(invoiceId);
        if (orderIds.length === 0) {
            throw new CustomError('Invoice tidak memiliki order yang bisa diverifikasi.', 404);
        }
        const relatedOrders = await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            attributes: ['id', 'courier_id']
        });
        if (relatedOrders.length === 0) {
            throw new CustomError('Invoice tidak memiliki order yang bisa diverifikasi.', 404);
        }
        const hasMismatch = relatedOrders.some((order) => String(order.courier_id || '').trim() !== String(user.id));
        if (hasMismatch) {
            throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
        }
    } else if (!['super_admin', 'admin_finance', 'kasir', 'admin_gudang'].includes(userRole)) {
        throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
    }

    const plain = invoice.get({ plain: true }) as any;
    const items = Array.isArray(plain.Items) ? plain.Items : [];
    const orderItemIds = Array.from(
        new Set(
            items
                .map((item: any) => String(item?.order_item_id || item?.OrderItem?.id || '').trim())
                .filter(Boolean)
        )
    );
    const invoiceCreatedAt = plain?.createdAt ? new Date(plain.createdAt) : null;
    const cumulativeAllocatedByOrderItemId = new Map<string, number>();

    if (orderItemIds.length > 0) {
        const historicalQuery: any = {
            where: { order_item_id: { [Op.in]: orderItemIds } }
        };
        if (invoiceCreatedAt) {
            historicalQuery.include = [{
                model: Invoice,
                attributes: ['id', 'createdAt'],
                required: true,
                where: {
                    createdAt: { [Op.lte]: invoiceCreatedAt }
                }
            }];
        }
        const historicalInvoiceItems = await InvoiceItem.findAll(historicalQuery);

        historicalInvoiceItems.forEach((hist: any) => {
            const key = String(hist?.order_item_id || '').trim();
            if (!key) return;
            const prev = Number(cumulativeAllocatedByOrderItemId.get(key) || 0);
            cumulativeAllocatedByOrderItemId.set(key, prev + Number(hist?.qty || 0));
        });
    }

    const orderIdSet = new Set<string>();
    items.forEach((item: any) => {
        const orderId = String(item?.OrderItem?.order_id || '').trim();
        if (orderId) orderIdSet.add(orderId);
    });
    const orderIds = Array.from(orderIdSet);

    const invoiceItems = items.map((item: any) => {
        const orderItem = item?.OrderItem || null;
        const orderItemId = String(item?.order_item_id || orderItem?.id || '').trim();
        const orderedQty = Number(orderItem?.ordered_qty_original || orderItem?.qty || item?.qty || 0);
        const invoiceQty = Number(item?.qty || 0);
        const allocatedQty = Number(cumulativeAllocatedByOrderItemId.get(orderItemId) || invoiceQty);
        const canceledBackorderQty = Number(orderItem?.qty_canceled_backorder || 0);
        const remainingQty = Math.max(0, orderedQty - allocatedQty - canceledBackorderQty);
        return {
            ...item,
            ordered_qty: orderedQty,
            invoice_qty: invoiceQty,
            allocated_qty: allocatedQty,
            remaining_qty: remainingQty,
            previously_allocated_qty: Math.max(0, allocatedQty - invoiceQty),
            canceled_backorder_qty: canceledBackorderQty,
        };
    });

    const customerId = String(plain?.customer_id || '');
    const customer = customerId
        ? await User.findOne({
            where: { id: customerId },
            attributes: ['id', 'name', 'email', 'whatsapp_number']
        })
        : null;

    return res.json({
        ...plain,
        InvoiceItems: invoiceItems,
        order_ids: orderIds,
        customer: customer ? customer.get({ plain: true }) : null,
    });
});

export const uploadInvoicePaymentProof = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const invoiceId = String(req.params.id || '').trim();
        const userId = String(req.user!.id || '');
        const file = req.file;

        if (!invoiceId) {
            throw new CustomError('invoice id wajib diisi', 400);
        }
        if (!file) {
            throw new CustomError('No file uploaded', 400);
        }

        const invoice = await Invoice.findByPk(invoiceId, {
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (!invoice) {
            throw new CustomError('Invoice tidak ditemukan', 404);
        }

        if (String(invoice.customer_id || '') !== userId) {
            throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
        }

        if (String(invoice.payment_method || '') !== 'transfer_manual') {
            throw new CustomError('Bukti transfer hanya berlaku untuk invoice transfer manual.', 400);
        }

        if (String(invoice.payment_status || '') === 'paid') {
            throw new CustomError('Invoice sudah dibayar.', 400);
        }

        if (invoice.payment_proof_url) {
            throw new CustomError('Bukti transfer sudah diunggah dan sedang dalam verifikasi.', 400);
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(invoiceId, { transaction: t });
        if (relatedOrderIds.length === 0) {
            throw new CustomError('Invoice tidak memiliki order terkait.', 404);
        }

        const relatedOrders = await Order.findAll({
            where: { id: { [Op.in]: relatedOrderIds } },
            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (relatedOrders.length === 0) {
            throw new CustomError('Invoice tidak memiliki order terkait.', 404);
        }
        for (const row of relatedOrders as any[]) {
            const currentStatus = String(row?.status || '').trim().toLowerCase();
            if (!isOrderTransitionAllowed(currentStatus, 'waiting_admin_verification')) {
                throw new CustomError(
                    `Order ${String(row?.id || '')} tidak bisa masuk status waiting_admin_verification dari status '${currentStatus}'.`,
                    409
                );
            }
        }
        for (const order of relatedOrders as any[]) {
            const orderPaymentMethod = String(order?.payment_method || '').trim().toLowerCase();
            if (orderPaymentMethod && orderPaymentMethod !== 'transfer_manual') {
                throw new CustomError('Metode pembayaran order sudah berubah. Bukti transfer tidak dapat diunggah untuk invoice ini.', 409);
            }
            const latestInvoice = await findLatestInvoiceByOrderId(String(order.id), { transaction: t });
            if (latestInvoice && String(latestInvoice.id) !== invoiceId) {
                throw new CustomError('Invoice ini sudah digantikan oleh invoice yang lebih baru. Bukti transfer tidak dapat diunggah untuk invoice ini.', 409);
            }
        }

        const previousStatuses = new Map<string, string>();
        relatedOrders.forEach((order) => {
            previousStatuses.set(String(order.id), String(order.status || ''));
        });

        await invoice.update({
            payment_proof_url: file.path,
            payment_status: 'unpaid',
            verified_by: null,
            verified_at: null,
        }, { transaction: t });

        await Order.update(
            { status: 'waiting_admin_verification' },
            { where: { id: { [Op.in]: relatedOrderIds } }, transaction: t }
        );

        for (const orderId of relatedOrderIds) {
            const previousStatus = previousStatuses.get(String(orderId)) || '';
            if (previousStatus !== 'waiting_admin_verification') {
                await emitOrderStatusChanged({
                    order_id: String(orderId),
                    from_status: previousStatus || null,
                    to_status: 'waiting_admin_verification',
                    source: '',
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: '',
                    triggered_by_role: String(req.user?.role || 'customer'),
                    target_roles: ['admin_finance', 'customer'],
                }, {
                    transaction: t,
                    requestContext: `invoice_payment_proof_status_changed:${invoiceId}:${orderId}`
                });
            }
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: `invoice_payment_proof_refresh_badges:${invoiceId}`
        });

        await t.commit();

        (async () => {
            try {
                const primaryOrder = relatedOrders[0];
                const primaryOrderPlain = primaryOrder?.get({ plain: true }) as any;
                const customerName = String(primaryOrderPlain?.customer_name || primaryOrderPlain?.Customer?.name || 'Customer');
                const customerWa = String(primaryOrderPlain?.Customer?.whatsapp_number || '').trim();
                const customerMsg = `[Migunani Motor] Bukti pembayaran untuk invoice ${invoice.invoice_number || invoice.id} telah kami terima. Pembayaran Anda akan segera diverifikasi oleh tim finance kami. Terima kasih!`;
                await enqueueWhatsappNotification({
                    target: customerWa,
                    textBody: customerMsg,
                    requestContext: `invoice_payment_proof_customer:${invoiceId}`
                });

                const financeAdmins = await User.findAll({ where: { role: 'admin_finance', status: 'active' } });
                const adminMsg = `[PEMBAYARAN] Bukti transfer baru diunggah untuk Invoice ${invoice.invoice_number || invoice.id}.\nCustomer: ${customerName}\nSilakan verifikasi di panel admin.`;

                for (const admin of financeAdmins) {
                    await enqueueWhatsappNotification({
                        target: String(admin.whatsapp_number || '').trim(),
                        textBody: adminMsg,
                        requestContext: `invoice_payment_proof_finance:${invoiceId}:${admin.id}`
                    });
                }
            } catch (notifError) {
                console.error('[WA_NOTIFY_OUTBOX_ENQUEUE_UNEXPECTED]', notifError);
            }
        })();

        res.json({ message: 'Payment proof uploaded for invoice' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const assignInvoiceDriver = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const invoiceId = String(req.params.id || '').trim();
        const { courier_id } = req.body;
        const actorId = String(req.user!.id);
        const userRole = req.user!.role;

        if (!['super_admin', 'admin_gudang'].includes(userRole)) {
            throw new CustomError('Hanya super admin atau admin gudang yang dapat melakukan penugasan driver.', 403);
        }

        if (!invoiceId) {
            throw new CustomError('ID Invoice wajib diisi', 400);
        }

        if (!courier_id) {
            throw new CustomError('Pilih driver terlebih dahulu', 400);
        }

        const invoice = await Invoice.findByPk(invoiceId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!invoice) {
            throw new CustomError('Invoice tidak ditemukan', 404);
        }

        const courier = await User.findOne({
            where: { id: courier_id, role: 'driver', status: 'active' },
            transaction: t
        });

        if (!courier) {
            throw new CustomError('Driver tidak ditemukan atau tidak aktif', 404);
        }

        if (String(invoice.shipment_status || '') === 'delivered' || invoice.delivered_at) {
            throw new CustomError('Invoice ini sudah selesai dikirim dan tidak bisa ditugaskan ulang ke driver.', 409);
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(invoiceId, { transaction: t });
        if (relatedOrderIds.length === 0) {
            throw new CustomError('Invoice ini tidak memiliki pesanan yang valid.', 400);
        }

        const orders = await Order.findAll({
            where: { id: { [Op.in]: relatedOrderIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const updatedOrderIds: string[] = [];
        for (const order of orders) {
            // Only update if status is shippable
            const shippableStatuses = ['ready_to_ship', 'allocated', 'hold', 'partially_fulfilled', 'waiting_payment'];
            if (shippableStatuses.includes(order.status)) {
                const prevStatus = order.status;

                await order.update({
                    status: 'shipped',
                    courier_id: courier.id
                }, { transaction: t });

                // Post Accounting
                if (invoice.payment_method !== 'cod') {
                    await AccountingPostingService.postGoodsOutForOrder(String(order.id), actorId, t, 'non_cod');
                } else {
                    await AccountingPostingService.postGoodsOutForOrder(String(order.id), actorId, t, 'cod');
                }

                await emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: 'shipped',
                    source: String(order.source || 'web'),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: courier.id,
                    triggered_by_role: userRole,
                    target_roles: ['driver', 'customer', 'admin_finance'],
                    target_user_ids: [courier.id]
                }, {
                    transaction: t,
                    requestContext: `invoice_assign_driver:${invoiceId}:${order.id}`
                });

                updatedOrderIds.push(String(order.id));
            }
        }

        if (updatedOrderIds.length === 0) {
            // Optional: Check if already shipped
            if (String(invoice.shipment_status || '') === 'delivered' || invoice.delivered_at) {
                throw new CustomError('Invoice ini sudah selesai dikirim.', 409);
            }
            if (invoice.shipment_status === 'shipped') {
                throw new CustomError('Invoice ini sudah dikirim sebelumnya.', 400);
            }
            throw new CustomError('Tidak ada pesanan dalam invoice ini yang siap untuk dikirim.', 400);
        }

        // Update Invoice status
        await invoice.update({
            shipment_status: 'shipped',
            shipped_at: new Date(),
            courier_id: courier.id
        }, { transaction: t });

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: `invoice_assign_driver_refresh:${invoiceId}`
        });

        await t.commit();

        res.json({
            message: `Berhasil menugaskan driver ${courier.name} untuk Invoice ${invoice.invoice_number}`,
            updated_orders: updatedOrderIds
        });

    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
