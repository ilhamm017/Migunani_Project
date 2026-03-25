import { Request, Response } from 'express';
import { Invoice, InvoiceItem, OrderItem, Product, User, Order, Retur, sequelize } from '../models';
import { Op } from 'sequelize';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId, findOrderIdsByInvoiceIds } from '../utils/invoiceLookup';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { enqueueWhatsappNotification } from '../services/TransactionNotificationOutboxService';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { isOrderTransitionAllowed } from '../utils/orderTransitions';
import { computeInvoiceNetTotals, computeInvoiceNetTotalsBulk } from '../utils/invoiceNetTotals';
import { recordOrderEvent } from '../utils/orderEvent';

const toObjectOrEmpty = (value: unknown): Record<string, any> => {
    if (!value) return {};
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
        } catch { }
        return {};
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
    return {};
};

const toFiniteNumberOrNull = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n;
};

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
                attributes: ['id', 'qty', 'unit_price', 'unit_cost', 'line_total', 'order_item_id'],
                include: [
                    {
                        model: OrderItem,
                        attributes: ['id', 'order_id', 'product_id', 'qty', 'ordered_qty_original', 'qty_canceled_backorder', 'pricing_snapshot'],
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
    const isAdminRole = ['super_admin', 'admin_finance', 'kasir', 'admin_gudang'].includes(userRole);
    if (userRole === 'customer') {
        const customerId = String(invoice.getDataValue('customer_id') || '').trim();
        const userId = String(user.id || '').trim();
        if (!userId) {
            throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
        }
        if (!customerId || customerId !== userId) {
            const orderIds = await findOrderIdsByInvoiceId(invoiceId);
            if (orderIds.length === 0) {
                throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
            }
            const linked = await Order.findOne({
                where: { id: { [Op.in]: orderIds }, customer_id: userId },
                attributes: ['id']
            });
            if (!linked) {
                throw new CustomError('Tidak memiliki akses ke invoice ini.', 403);
            }
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

    let invoiceItems: any[] = items.map((item: any) => {
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

    if (!isAdminRole) {
        invoiceItems = invoiceItems.map((item: any) => {
            if (!item || typeof item !== 'object') return item;
            if (!item.OrderItem || typeof item.OrderItem !== 'object') return item;
            const nextOrderItem = { ...item.OrderItem };
            delete (nextOrderItem as any).pricing_snapshot;
            const nextItem = { ...item, OrderItem: nextOrderItem };
            delete (nextItem as any).unit_cost;
            delete (nextItem as any).unit_cost_override;
            return nextItem;
        });
    }

    if (isAdminRole) {
        const orderNotesById = new Map<string, string | null>();
        if (orderIds.length > 0) {
            const relatedOrders = await Order.findAll({
                where: { id: { [Op.in]: orderIds } },
                attributes: ['id', 'pricing_override_note']
            });
            relatedOrders.forEach((row: any) => {
                orderNotesById.set(String(row?.id || ''), row?.pricing_override_note ? String(row.pricing_override_note) : null);
            });
        }

        invoiceItems = invoiceItems.map((item: any) => {
            const orderItem = item?.OrderItem || null;
            const pricingSnapshot = toObjectOrEmpty(orderItem?.pricing_snapshot);
            const baselineRaw = pricingSnapshot?.computed_unit_price ?? pricingSnapshot?.computedUnitPrice ?? null;
            const finalUnitPrice = toFiniteNumberOrNull(item?.unit_price) ?? 0;
            const baselineUnitPrice = toFiniteNumberOrNull(baselineRaw) ?? finalUnitPrice;
            const qty = Math.max(0, Number(item?.qty || 0));
            const diffPerUnit = Math.round((baselineUnitPrice - finalUnitPrice) * 100) / 100;
            const diffTotal = Math.round(diffPerUnit * qty * 100) / 100;

            const override = toObjectOrEmpty(pricingSnapshot?.override);
            const history = Array.isArray(pricingSnapshot?.override_history) ? pricingSnapshot.override_history : [];
            const lastHistory = history.length > 0 ? toObjectOrEmpty(history[history.length - 1]) : {};
            const reasonItem = String(override?.reason || lastHistory?.reason || '').trim() || null;
            const actorUserId = override?.actor_user_id ?? lastHistory?.actor_user_id ?? null;
            const actorRole = override?.actor_role ?? lastHistory?.actor_role ?? null;

            const orderId = String(orderItem?.order_id || '').trim();
            const reasonOrder = orderId ? (orderNotesById.get(orderId) ?? null) : null;

            return {
                ...item,
                baseline_unit_price: baselineUnitPrice,
                final_unit_price: finalUnitPrice,
                price_diff_per_unit: diffPerUnit,
                price_diff_total: diffTotal,
                override_reason_item: reasonItem,
                override_reason_order: reasonOrder,
                override_actor: (actorUserId || actorRole)
                    ? { actor_user_id: actorUserId ? String(actorUserId) : null, actor_role: actorRole ? String(actorRole) : null }
                    : null
            };
        });
    }

    const customerId = String(plain?.customer_id || '');
    const customer = customerId
        ? await User.findOne({
            where: { id: customerId },
            attributes: ['id', 'name', 'email', 'whatsapp_number']
        })
        : userRole === 'customer'
            ? await User.findOne({
                where: { id: String(user.id) },
                attributes: ['id', 'name', 'email', 'whatsapp_number']
            })
            : null;

    const deliveryReturs = orderIds.length > 0
        ? await Retur.findAll({
            where: {
                order_id: { [Op.in]: orderIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: { [Op.ne]: 'rejected' }
            },
            include: [
                { model: Product, attributes: ['id', 'name', 'sku', 'unit'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'], required: false }
            ],
            order: [['createdAt', 'ASC']]
        })
        : [];
    const deliveryReturnSummary = await computeInvoiceNetTotals(invoiceId);

    return res.json({
        ...plain,
        InvoiceItems: invoiceItems,
        order_ids: orderIds,
        customer: customer ? customer.get({ plain: true }) : null,
        delivery_returs: deliveryReturs.map((r: any) => r.get({ plain: true })),
        delivery_return_summary: deliveryReturnSummary
    });
});

const parseCsvList = (raw: unknown): string[] =>
    String(raw || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

const parseTriBool = (raw: unknown): boolean | null => {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
};

const parseDateOrNull = (raw: unknown, opts?: { endOfDay?: boolean }): Date | null => {
    const value = String(raw || '').trim();
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = dateOnly ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    if (opts?.endOfDay && dateOnly) {
        return new Date(`${value}T23:59:59.999Z`);
    }
    return date;
};

export const getMyInvoices = asyncWrapper(async (req: Request, res: Response) => {
    const user = req.user!;
    const userRole = String(user?.role || '');
    if (userRole !== 'customer') {
        throw new CustomError('Tidak memiliki akses ke invoice customer.', 403);
    }

    const userId = String(user.id || '').trim();
    if (!userId) {
        throw new CustomError('Tidak memiliki akses ke invoice customer.', 403);
    }

    const page = Math.max(1, Number((req.query as any)?.page || 1) || 1);
    const rawLimit = Number((req.query as any)?.limit || 20) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const q = String((req.query as any)?.q || '').trim();
    const stage = String((req.query as any)?.stage || 'all').trim().toLowerCase();
    const includeCollectibleTotals = String((req.query as any)?.include_collectible_total || 'true') === 'true';

    const paymentStatusAllowed = new Set(['unpaid', 'paid', 'cod_pending', 'draft']);
    const paymentMethodAllowed = new Set(['pending', 'transfer_manual', 'cod', 'cash_store']);
    const shipmentStatusAllowed = new Set(['ready_to_ship', 'checked', 'shipped', 'delivered', 'canceled']);
    const sortAllowed = new Set([
        'createdAt_desc',
        'createdAt_asc',
        'total_desc',
        'total_asc',
        'expiry_desc',
        'expiry_asc'
    ]);

    const payment_status = parseCsvList((req.query as any)?.payment_status).filter((v) => paymentStatusAllowed.has(v));
    const payment_method = parseCsvList((req.query as any)?.payment_method).filter((v) => paymentMethodAllowed.has(v));
    const shipment_status = parseCsvList((req.query as any)?.shipment_status).filter((v) => shipmentStatusAllowed.has(v));
    const orderId = String((req.query as any)?.order_id || '').trim();
    const hasProof = parseTriBool((req.query as any)?.has_proof);
    const verified = parseTriBool((req.query as any)?.verified);
    const createdFrom = parseDateOrNull((req.query as any)?.created_from);
    const createdTo = parseDateOrNull((req.query as any)?.created_to, { endOfDay: true });
    const expiryFrom = parseDateOrNull((req.query as any)?.expiry_from);
    const expiryTo = parseDateOrNull((req.query as any)?.expiry_to, { endOfDay: true });
    const sort = String((req.query as any)?.sort || 'createdAt_desc').trim();
    const minTotal = Number((req.query as any)?.min_total);
    const maxTotal = Number((req.query as any)?.max_total);

    const andClauses: any[] = [];
    if (q) {
        andClauses.push({
            [Op.or]: [
                { invoice_number: { [Op.like]: `%${q}%` } },
                ...(q.length >= 8 ? [{ id: q }] : [])
            ]
        });
    }
    if (payment_status.length > 0) andClauses.push({ payment_status: { [Op.in]: payment_status } });
    if (payment_method.length > 0) andClauses.push({ payment_method: { [Op.in]: payment_method } });
    if (shipment_status.length > 0) andClauses.push({ shipment_status: { [Op.in]: shipment_status } });
    if (createdFrom || createdTo) {
        andClauses.push({
            createdAt: {
                ...(createdFrom ? { [Op.gte]: createdFrom } : {}),
                ...(createdTo ? { [Op.lte]: createdTo } : {})
            }
        });
    }
    if (expiryFrom || expiryTo) {
        andClauses.push({
            expiry_date: {
                ...(expiryFrom ? { [Op.gte]: expiryFrom } : {}),
                ...(expiryTo ? { [Op.lte]: expiryTo } : {})
            }
        });
    }
    if (Number.isFinite(minTotal)) andClauses.push({ total: { [Op.gte]: minTotal } });
    if (Number.isFinite(maxTotal)) andClauses.push({ total: { [Op.lte]: maxTotal } });

    if (stage === 'completed') {
        andClauses.push({
            [Op.or]: [
                { payment_status: 'paid' },
                { payment_status: 'cod_pending', amount_paid: { [Op.gt]: 0 } }
            ]
        });
    } else if (stage === 'active') {
        andClauses.push({
            [Op.or]: [
                { payment_status: { [Op.in]: ['draft', 'unpaid'] } },
                {
                    payment_status: 'cod_pending',
                    [Op.or]: [{ amount_paid: { [Op.lte]: 0 } }, { amount_paid: null }]
                }
            ]
        });
    }

    if (hasProof !== null) {
        if (hasProof) {
            andClauses.push({ payment_proof_url: { [Op.ne]: null } });
            andClauses.push({ payment_proof_url: { [Op.ne]: '' } });
        } else {
            andClauses.push({ [Op.or]: [{ payment_proof_url: null }, { payment_proof_url: '' }] });
        }
    }

    if (verified !== null) {
        andClauses.push({ verified_at: verified ? { [Op.ne]: null } : null });
    }

    const whereClause: any = andClauses.length > 0 ? { [Op.and]: andClauses } : {};

    const orderWhere: any = { customer_id: userId };
    if (orderId) orderWhere.id = orderId;

    const orderBy: any[] = (() => {
        const selected = sortAllowed.has(sort) ? sort : 'createdAt_desc';
        if (selected === 'createdAt_asc') return [['createdAt', 'ASC']];
        if (selected === 'total_desc') return [['total', 'DESC'], ['createdAt', 'DESC']];
        if (selected === 'total_asc') return [['total', 'ASC'], ['createdAt', 'DESC']];
        if (selected === 'expiry_asc') return [['expiry_date', 'ASC'], ['createdAt', 'DESC']];
        if (selected === 'expiry_desc') return [['expiry_date', 'DESC'], ['createdAt', 'DESC']];
        return [['createdAt', 'DESC']];
    })();

    const result = await Invoice.findAndCountAll({
        where: whereClause,
        attributes: [
            'id',
            'invoice_number',
            'payment_status',
            'payment_method',
            'payment_proof_url',
            'amount_paid',
            'subtotal',
            'discount_amount',
            'shipping_fee_total',
            'tax_amount',
            'total',
            'shipment_status',
            'shipped_at',
            'delivered_at',
            'delivery_proof_url',
            'verified_at',
            'expiry_date',
            'createdAt',
            'updatedAt'
        ],
        include: [
            {
                model: InvoiceItem,
                as: 'Items',
                attributes: [],
                required: true,
                include: [
                    {
                        model: OrderItem,
                        attributes: [],
                        required: true,
                        include: [
                            {
                                model: Order,
                                attributes: [],
                                required: true,
                                where: orderWhere
                            }
                        ]
                    }
                ]
            }
        ],
        distinct: true,
        limit,
        offset,
        order: orderBy
    });

    const invoices = result.rows.map((row) => row.get({ plain: true }) as any);
    const invoiceIds = invoices.map((inv) => String(inv?.id || '').trim()).filter(Boolean);
    const orderIdsByInvoiceId = await findOrderIdsByInvoiceIds(invoiceIds);
    const totalsByInvoiceId = includeCollectibleTotals && invoiceIds.length > 0
        ? await computeInvoiceNetTotalsBulk(invoiceIds)
        : new Map<string, any>();

    const enriched = invoices.map((inv) => {
        const id = String(inv?.id || '').trim();
        const computed = totalsByInvoiceId.get(id);
        return {
            ...inv,
            orderIds: orderIdsByInvoiceId.get(id) || [],
            collectible_total: computed ? Number(computed.net_total || 0) : null,
            delivery_return_summary: computed || null
        };
    });

    return res.json({
        total: result.count,
        totalPages: Math.ceil(Number(result.count) / limit),
        currentPage: page,
        limit,
        invoices: enriched
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
            // Assigning driver should NOT mark shipped. Shipped is set at actual handover (checker step).
            const assignableStatuses = ['ready_to_ship', 'checked', 'allocated', 'hold', 'partially_fulfilled', 'waiting_payment'];
            if (!assignableStatuses.includes(String(order.status || ''))) continue;

            await order.update({
                courier_id: courier.id
            }, { transaction: t });

            await recordOrderEvent({
                transaction: t,
                order_id: String(order.id),
                invoice_id: invoiceId,
                event_type: 'driver_assigned',
                payload: { courier_id: courier.id },
                actor_user_id: actorId,
                actor_role: userRole
            });

            updatedOrderIds.push(String(order.id));
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

        // Update Invoice courier only (shipment_status unchanged)
        await invoice.update({
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
