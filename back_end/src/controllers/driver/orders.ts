import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Order, OrderItem, Invoice, Product, OrderIssue, sequelize, User, CustomerProfile, Retur, CodCollection, InvoiceItem, DriverDebtAdjustment } from '../../models';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged, emitReturStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findDriverInvoiceContextByOrderOrInvoiceId, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { isDeadlockError, FINAL_ORDER_STATUSES, COURIER_OWNERSHIP_REQUIRED_STATUSES } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { computeInvoiceNetTotals } from '../../utils/invoiceNetTotals';
import { calculateDriverCodExposure } from '../../utils/codExposure';

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
            whereClause.status = { [Op.in]: ['ready_to_ship', 'checked', 'shipped', 'delivered'] };
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

export const createDeliveryReturTicket = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const driverId = String(req.user!.id || '').trim();
        const id = String(req.params?.id || '').trim();
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const rawReturType = String(req.body?.retur_type || 'delivery_refusal').trim().toLowerCase();
        const returType = rawReturType === 'delivery_damage' ? 'delivery_damage' : 'delivery_refusal';
        if (rawReturType && !['delivery_refusal', 'delivery_damage'].includes(rawReturType)) {
            await t.rollback();
            throw new CustomError('retur_type tidak valid. Gunakan delivery_refusal atau delivery_damage.', 400);
        }

        if (!id) {
            await t.rollback();
            throw new CustomError('Order/Invoice ID wajib diisi', 400);
        }
        if (items.length === 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi', 400);
        }

        const context = await findDriverInvoiceContextByOrderOrInvoiceId(id, driverId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const invoice = context.invoice;
        const orders = context.orders;
        if (!invoice || orders.length === 0) {
            await t.rollback();
            throw new CustomError('Order/invoice tidak ditemukan atau bukan tugas Anda.', 404);
        }

        const orderIds = orders.map((o: any) => String(o.id)).filter(Boolean);

        const existingDeliveryRetur = await Retur.findOne({
            where: {
                order_id: { [Op.in]: orderIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: { [Op.ne]: 'rejected' }
            },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (existingDeliveryRetur) {
            await t.rollback();
            throw new CustomError('Retur delivery untuk invoice ini sudah diajukan dan tidak bisa diubah.', 409);
        }

        const invoiceItems = await InvoiceItem.findAll({
            where: { invoice_id: String(invoice.id) },
            include: [{
                model: OrderItem,
                required: true,
                attributes: ['id', 'order_id', 'product_id'],
                where: { order_id: { [Op.in]: orderIds } }
            }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const invoiceQtyByOrderProduct = new Map<string, number>();
        invoiceItems.forEach((row: any) => {
            const orderId = String(row?.OrderItem?.order_id || '').trim();
            const productId = String(row?.OrderItem?.product_id || '').trim();
            if (!orderId || !productId) return;
            const key = `${orderId}:${productId}`;
            invoiceQtyByOrderProduct.set(key, Number(invoiceQtyByOrderProduct.get(key) || 0) + Math.max(0, Number(row?.qty || 0)));
        });

        const requestedProductIds: string[] = Array.from(new Set(
            items.map((it: any) => String(it?.product_id || '').trim()).filter(Boolean)
        ));
        if (requestedProductIds.length === 0) {
            await t.rollback();
            throw new CustomError('product_id wajib diisi', 400);
        }

        const existingReturs = await Retur.findAll({
            where: {
                order_id: { [Op.in]: orderIds },
                product_id: { [Op.in]: requestedProductIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: { [Op.ne]: 'rejected' }
            },
            attributes: ['order_id', 'product_id', 'qty', 'status', 'qty_received'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        const existingQtyByOrderProduct = new Map<string, number>();
        existingReturs.forEach((retur: any) => {
            const orderId = String(retur?.order_id || '').trim();
            const productId = String(retur?.product_id || '').trim();
            if (!orderId || !productId) return;
            const key = `${orderId}:${productId}`;
            existingQtyByOrderProduct.set(key, Number(existingQtyByOrderProduct.get(key) || 0) + Math.max(0, Number(retur?.qty || 0)));
        });

        const orderById = new Map<string, any>();
        orders.forEach((o: any) => orderById.set(String(o.id), o));

        const invoiceValueByOrderProduct = new Map<string, { qty: number; value: number }>();
        invoiceItems.forEach((row: any) => {
            const orderId = String(row?.OrderItem?.order_id || '').trim();
            const productId = String(row?.OrderItem?.product_id || '').trim();
            if (!orderId || !productId) return;
            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const unitPrice = Math.max(0, Number(row?.unit_price || 0));
            const key = `${orderId}:${productId}`;
            const prev = invoiceValueByOrderProduct.get(key) || { qty: 0, value: 0 };
            prev.qty += qty;
            prev.value += qty * unitPrice;
            invoiceValueByOrderProduct.set(key, prev);
        });

        const createdReturs: any[] = [];
        for (const raw of items) {
            const productId = String(raw?.product_id || '').trim();
            const qty = Math.max(0, Math.trunc(Number(raw?.qty || 0)));
            const reason = typeof raw?.reason === 'string' && raw.reason.trim()
                ? raw.reason.trim()
                : (returType === 'delivery_damage'
                    ? 'Retur saat pengiriman (barang rusak)'
                    : 'Retur saat pengiriman (tidak jadi beli)');
            const evidenceImg = typeof raw?.evidence_img === 'string' && raw.evidence_img.trim() ? raw.evidence_img.trim() : null;
            const requestedOrderId = typeof raw?.order_id === 'string' ? raw.order_id.trim() : '';

            if (!productId) {
                await t.rollback();
                throw new CustomError('product_id wajib diisi', 400);
            }
            if (!Number.isFinite(qty) || qty <= 0) {
                await t.rollback();
                throw new CustomError('qty retur tidak valid', 400);
            }

            let resolvedOrderId = requestedOrderId;
            if (resolvedOrderId) {
                if (!orderById.has(resolvedOrderId)) {
                    await t.rollback();
                    throw new CustomError('order_id tidak valid untuk invoice ini', 400);
                }
                const key = `${resolvedOrderId}:${productId}`;
                if (!invoiceQtyByOrderProduct.has(key)) {
                    await t.rollback();
                    throw new CustomError('Produk tidak ditemukan pada invoice untuk order tersebut', 400);
                }
            } else {
                const candidates = orderIds.filter((oid) => invoiceQtyByOrderProduct.has(`${oid}:${productId}`));
                if (candidates.length === 0) {
                    await t.rollback();
                    throw new CustomError('Produk tidak ditemukan pada invoice ini', 400);
                }
                if (candidates.length > 1) {
                    await t.rollback();
                    throw new CustomError('Produk ada di beberapa order dalam invoice ini. Mohon sertakan order_id.', 409);
                }
                resolvedOrderId = candidates[0];
            }

            const key = `${resolvedOrderId}:${productId}`;
            const invoiceQty = Math.max(0, Number(invoiceQtyByOrderProduct.get(key) || 0));
            const existingQty = Math.max(0, Number(existingQtyByOrderProduct.get(key) || 0));
            if (qty + existingQty > invoiceQty) {
                await t.rollback();
                throw new CustomError(`Qty retur melebihi qty di invoice (${qty + existingQty}/${invoiceQty}).`, 409);
            }

            const ownerOrder = orderById.get(resolvedOrderId);
            const customerId = String(ownerOrder?.customer_id || '').trim();
            if (!customerId) {
                await t.rollback();
                throw new CustomError('Order ini tidak memiliki customer_id. Retur delivery tidak bisa dibuat.', 409);
            }

            const retur = await Retur.create({
                retur_type: returType,
                order_id: resolvedOrderId,
                product_id: productId,
                qty,
                reason,
                evidence_img: evidenceImg,
                status: 'picked_up',
                created_by: customerId,
                courier_id: driverId
            }, { transaction: t });

            await emitReturStatusChanged({
                retur_id: String(retur.id),
                order_id: String(resolvedOrderId),
                from_status: null,
                to_status: 'picked_up',
                courier_id: driverId,
                triggered_by_role: String(req.user?.role || 'driver'),
                target_roles: ['driver', 'kasir', 'admin_gudang', 'admin_finance', 'customer', 'super_admin'],
                target_user_ids: [driverId]
            }, {
                transaction: t,
                requestContext: 'driver_create_delivery_retur_ticket'
            });

            existingQtyByOrderProduct.set(key, existingQty + qty);
            createdReturs.push(retur.get({ plain: true }));
        }

        const invoiceNetTotals = await computeInvoiceNetTotals(String(invoice.id), { transaction: t });

        if (returType === 'delivery_damage') {
            const totalDelta = Math.max(0, Math.round(Number(invoiceNetTotals?.return_total || 0) * 100) / 100);
            if (totalDelta > 0 && createdReturs.length > 0) {
                const weights = createdReturs.map((r) => {
                    const orderId = String(r?.order_id || '').trim();
                    const productId = String(r?.product_id || '').trim();
                    const qty = Math.max(0, Math.trunc(Number(r?.qty || 0)));
                    const key = `${orderId}:${productId}`;
                    const invAgg = invoiceValueByOrderProduct.get(key);
                    const avgUnit = invAgg && invAgg.qty > 0 ? (invAgg.value / invAgg.qty) : 0;
                    const value = Math.max(0, avgUnit * qty);
                    return { retur_id: String(r?.id), qty, value };
                });
                const sumValue = weights.reduce((sum, w) => sum + Number(w.value || 0), 0);
                let allocated = 0;
                for (let idx = 0; idx < weights.length; idx += 1) {
                    const w = weights[idx];
                    const isLast = idx === weights.length - 1;
                    const portion = sumValue > 0 ? (totalDelta * (Number(w.value || 0) / sumValue)) : (totalDelta / weights.length);
                    const amount = isLast
                        ? Math.max(0, Math.round((totalDelta - allocated) * 100) / 100)
                        : Math.max(0, Math.round(portion * 100) / 100);
                    allocated = Math.round((allocated + amount) * 100) / 100;

                    const existing = await DriverDebtAdjustment.findOne({
                        where: { retur_id: String(w.retur_id) },
                        transaction: t,
                        lock: t.LOCK.UPDATE
                    });
                    const note = `Kompensasi retur barang rusak (invoice ${String(invoice.id).slice(0, 8)}).`;
                    if (existing) {
                        await existing.update({
                            driver_id: driverId,
                            invoice_id: String(invoice.id),
                            amount,
                            status: 'open',
                            note,
                            created_by: driverId
                        }, { transaction: t });
                    } else {
                        await DriverDebtAdjustment.create({
                            driver_id: driverId,
                            invoice_id: String(invoice.id),
                            retur_id: String(w.retur_id),
                            amount,
                            status: 'open',
                            note,
                            created_by: driverId
                        }, { transaction: t });
                    }
                }

                const driver = await User.findByPk(driverId, { transaction: t, lock: t.LOCK.UPDATE });
                if (driver) {
                    const exposure = await calculateDriverCodExposure(driverId, { transaction: t });
                    await driver.update({ debt: exposure.exposure }, { transaction: t });
                }
            }
        }

        await t.commit();

        return res.status(201).json({
            message: 'Tiket retur berhasil dibuat.',
            invoice_id: String(invoice.id),
            invoice_net_totals: invoiceNetTotals,
            returs: createdReturs
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal membuat tiket retur', 500);
    }
});
