import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { Invoice, InvoiceItem, OrderItem, PosSale, PosSaleItem, Product, User, Order, Retur, DeliveryHandover, DeliveryHandoverItem, ReturHandover, ReturHandoverItem, sequelize } from '../models';
import { Op, QueryTypes } from 'sequelize';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId, findOrderIdsByInvoiceIds } from '../utils/invoiceLookup';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { enqueueWhatsappNotification } from '../services/TransactionNotificationOutboxService';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { isOrderTransitionAllowed } from '../utils/orderTransitions';
import { computeInvoiceNetTotals, computeInvoiceNetTotalsBulk } from '../utils/invoiceNetTotals';
import { recordOrderEvent, recordOrderStatusChanged } from '../utils/orderEvent';
import { normalizeNullableUuid } from '../utils/uuid';

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

    const salesChannel = String((invoice as any)?.sales_channel || '').trim().toLowerCase();
    const posSaleId = normalizeNullableUuid((invoice as any)?.pos_sale_id);
    if (salesChannel === 'pos' || posSaleId) {
        if (!posSaleId) {
            throw new CustomError('Invoice POS tidak memiliki pos_sale_id.', 409);
        }

        const sale = await PosSale.findByPk(posSaleId, {
            include: [
                { association: 'Cashier' as any, attributes: ['id', 'name', 'role'], required: false },
                { association: 'Customer' as any, attributes: ['id', 'name', 'email', 'whatsapp_number'], required: false },
            ]
        }) as any;
        if (!sale) {
            throw new CustomError('Transaksi POS untuk invoice ini tidak ditemukan.', 404);
        }

        const items = await PosSaleItem.findAll({
            where: { pos_sale_id: posSaleId },
            order: [['id', 'ASC']]
        }) as any[];

        const plain = invoice.get({ plain: true }) as any;
        const mappedItems = (Array.isArray(items) ? items : []).map((row: any) => {
            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const unitPrice = Number(row?.unit_price || 0);
            const unitCost = Number(row?.unit_cost || 0);
            const lineTotal = Number(row?.line_total || 0);
            return {
                id: row?.id,
                qty,
                unit_price: unitPrice,
                unit_cost: unitCost,
                line_total: lineTotal,
                order_item_id: null,
                OrderItem: {
                    id: null,
                    order_id: null,
                    product_id: String(row?.product_id || '').trim() || null,
                    qty,
                    ordered_qty_original: qty,
                    qty_canceled_backorder: 0,
                    qty_canceled_manual: 0,
                    pricing_snapshot: null,
                    Product: {
                        name: String(row?.name_snapshot || '').trim() || null,
                        sku: String(row?.sku_snapshot || '').trim() || null,
                        unit: String(row?.unit_snapshot || '').trim() || null,
                    }
                },
                ordered_qty: qty,
                invoice_qty: qty,
                allocated_qty: qty,
                remaining_qty: 0,
                previously_allocated_qty: 0,
                canceled_backorder_qty: 0,
            };
        });

        plain.Items = mappedItems;

        const invoiceCustomerId = String(plain?.customer_id || '').trim();
        const customer = invoiceCustomerId
            ? await User.findOne({
                where: { id: invoiceCustomerId },
                attributes: ['id', 'name', 'email', 'whatsapp_number']
            })
            : null;

        return res.json({
            ...plain,
            InvoiceItems: mappedItems,
            order_ids: [],
            customer: customer ? customer.get({ plain: true }) : null,
            delivery_returs: [],
            delivery_return_summary: null,
            warehouse_handover_latest: null,
            warehouse_handover_history: null,
            pos_sale: sale.get({ plain: true }),
        });
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

    // Attach baseline (pricelist) vs final unit price so the invoice print page can show Subtotal from pricelist.
    // NOTE: pricing_snapshot is still removed for non-admins below; we only expose the derived baseline number.
    invoiceItems = invoiceItems.map((item: any) => {
        const orderItem = item?.OrderItem || null;
        const pricingSnapshot = toObjectOrEmpty(orderItem?.pricing_snapshot);
        const baselineRaw = pricingSnapshot?.computed_unit_price ?? pricingSnapshot?.computedUnitPrice ?? null;
        const finalUnitPrice = toFiniteNumberOrNull(item?.unit_price) ?? 0;
        const baselineUnitPrice = toFiniteNumberOrNull(baselineRaw) ?? finalUnitPrice;
        return {
            ...item,
            baseline_unit_price: baselineUnitPrice,
            final_unit_price: finalUnitPrice,
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
            const baselineUnitPrice = toFiniteNumberOrNull(item?.baseline_unit_price) ?? (toFiniteNumberOrNull(item?.unit_price) ?? 0);
            const finalUnitPrice = toFiniteNumberOrNull(item?.final_unit_price) ?? (toFiniteNumberOrNull(item?.unit_price) ?? 0);
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
                {
                    model: ReturHandoverItem,
                    as: 'HandoverItem',
                    required: true,
                    attributes: [],
                    include: [{
                        model: ReturHandover,
                        as: 'Handover',
                        required: true,
                        attributes: [],
                        where: { invoice_id: invoiceId }
                    }]
                },
                { model: Product, attributes: ['id', 'name', 'sku', 'unit'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'whatsapp_number'], required: false }
            ],
            order: [['createdAt', 'ASC']]
        })
        : [];
    const deliveryReturnSummary = await computeInvoiceNetTotals(invoiceId);

    const warehouse_handover_latest = isAdminRole
        ? await (async () => {
            const latest = await DeliveryHandover.findOne({
                where: { invoice_id: invoiceId },
                order: [['checked_at', 'DESC'], ['id', 'DESC']],
                attributes: ['id', 'invoice_id', 'courier_id', 'checker_id', 'status', 'checked_at', 'handed_over_at', 'note', 'evidence_url'],
                include: [
                    { model: User, as: 'Driver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
                    { model: User, as: 'Checker', attributes: ['id', 'name', 'whatsapp_number'], required: false },
                    {
                        model: DeliveryHandoverItem,
                        as: 'Items',
                        attributes: ['id', 'product_id', 'qty_expected', 'qty_checked', 'condition', 'note', 'evidence_url'],
                        required: false,
                        include: [{ model: Product, as: 'Product', attributes: ['id', 'name', 'sku', 'unit'], required: false }]
                    }
                ]
            }) as any;
            return latest ? latest.get({ plain: true }) : null;
        })()
        : null;

    const warehouse_handover_history = isAdminRole
        ? await (async () => {
            const rows = await DeliveryHandover.findAll({
                where: { invoice_id: invoiceId },
                order: [['checked_at', 'DESC'], ['id', 'DESC']],
                limit: 20,
                attributes: ['id', 'invoice_id', 'courier_id', 'checker_id', 'status', 'checked_at', 'handed_over_at', 'note', 'evidence_url'],
                include: [
                    { model: User, as: 'Driver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
                    { model: User, as: 'Checker', attributes: ['id', 'name', 'whatsapp_number'], required: false },
                    {
                        model: DeliveryHandoverItem,
                        as: 'Items',
                        attributes: ['id', 'product_id', 'qty_expected', 'qty_checked', 'condition', 'note', 'evidence_url'],
                        required: false,
                        include: [{ model: Product, as: 'Product', attributes: ['id', 'name', 'sku', 'unit'], required: false }]
                    }
                ]
            }) as any[];
            return (Array.isArray(rows) ? rows : []).map((row: any) => row.get({ plain: true }));
        })()
        : null;

    return res.json({
        ...plain,
        InvoiceItems: invoiceItems,
        order_ids: orderIds,
        customer: customer ? customer.get({ plain: true }) : null,
        delivery_returs: deliveryReturs.map((r: any) => r.get({ plain: true })),
        delivery_return_summary: deliveryReturnSummary,
        warehouse_handover_latest,
        warehouse_handover_history
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

type InvoicePicklistRow = {
    product_id: string;
    sku: string;
    name: string;
    bin_location: string | null;
    total_qty: number;
    batch_layers?: Array<{ unit_cost: number; qty_reserved: number }>;
};

const requireInvoicePicklistRoles = (roleRaw: unknown) => {
    const role = String(roleRaw || '').trim();
    if (!['super_admin', 'admin_gudang', 'checker_gudang'].includes(role)) {
        throw new CustomError('Tidak memiliki akses untuk picklist gudang invoice.', 403);
    }
};

const buildInvoicePicklist = async (invoiceId: string, opts?: { transaction?: any }) => {
    const invoice = await Invoice.findByPk(invoiceId, {
        attributes: ['id', 'invoice_number', 'shipment_status', 'createdAt'],
        transaction: opts?.transaction,
        lock: opts?.transaction ? opts.transaction.LOCK.UPDATE : undefined,
    }) as any;
    if (!invoice) throw new CustomError('Invoice tidak ditemukan', 404);

    const items = await InvoiceItem.findAll({
        where: { invoice_id: invoiceId },
        attributes: ['id', 'qty', 'order_item_id'],
        include: [
            {
                model: OrderItem,
                attributes: ['id', 'order_id', 'product_id'],
                required: true,
                include: [
                    {
                        model: Product,
                        attributes: ['id', 'name', 'sku', 'bin_location'],
                        required: false,
                    }
                ],
            },
        ],
        transaction: opts?.transaction,
        lock: opts?.transaction ? opts.transaction.LOCK.UPDATE : undefined,
    }) as any[];

    const byProduct = new Map<string, InvoicePicklistRow>();
    const orderIdSet = new Set<string>();
    let totalQty = 0;

    for (const item of Array.isArray(items) ? items : []) {
        const qty = Math.max(0, Math.trunc(Number(item?.qty || 0)));
        if (qty <= 0) continue;

        const orderItem = item?.OrderItem || null;
        const productRef = orderItem?.Product || null;
        const orderId = String(orderItem?.order_id || '').trim();
        if (orderId) orderIdSet.add(orderId);
        const productId = String(orderItem?.product_id || productRef?.id || '').trim();
        if (!productId) continue;

        const existing = byProduct.get(productId);
        const sku = String(productRef?.sku || productId || '').trim();
        const name = String(productRef?.name || 'Produk');
        const binLocation = productRef?.bin_location ? String(productRef.bin_location) : null;

        if (!existing) {
            byProduct.set(productId, {
                product_id: productId,
                sku,
                name,
                bin_location: binLocation,
                total_qty: qty,
            });
        } else {
            existing.total_qty += qty;
        }

        totalQty += qty;
    }

    const rows = Array.from(byProduct.values()).sort((a, b) => {
        const binA = String(a.bin_location || '');
        const binB = String(b.bin_location || '');
        if (binA !== binB) return binA.localeCompare(binB);
        return String(a.sku || '').localeCompare(String(b.sku || ''));
    });

    // Attach reserved batch layers (HPP) so warehouse doesn't pick wrong batch.
    const orderIds = Array.from(orderIdSet).filter(Boolean);
    const productIds = Array.from(byProduct.keys()).filter(Boolean);
    if (orderIds.length > 0 && productIds.length > 0) {
        const reservedRows = await sequelize.query(
            `SELECT
                r.product_id AS product_id,
                b.unit_cost AS unit_cost,
                COALESCE(SUM(r.qty_reserved), 0) AS qty_reserved
             FROM inventory_batch_reservations r
             INNER JOIN inventory_batches b ON b.id = r.batch_id
             WHERE r.order_id IN (:orderIds)
               AND r.product_id IN (:productIds)
             GROUP BY r.product_id, b.unit_cost`,
            {
                type: QueryTypes.SELECT,
                replacements: { orderIds, productIds },
                transaction: opts?.transaction,
            }
        ) as any[];

        const layersByProductId = new Map<string, Array<{ unit_cost: number; qty_reserved: number }>>();
        (Array.isArray(reservedRows) ? reservedRows : []).forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            const unitCost = Number(row?.unit_cost || 0);
            const qtyReserved = Math.max(0, Math.trunc(Number(row?.qty_reserved || 0)));
            if (!Number.isFinite(unitCost) || unitCost <= 0 || qtyReserved <= 0) return;
            const list = layersByProductId.get(productId) || [];
            list.push({ unit_cost: unitCost, qty_reserved: qtyReserved });
            layersByProductId.set(productId, list);
        });
        layersByProductId.forEach((list, productId) => {
            layersByProductId.set(productId, [...list].sort((a, b) => a.unit_cost - b.unit_cost));
        });

        rows.forEach((row) => {
            const layers = layersByProductId.get(row.product_id) || [];
            if (layers.length > 0) row.batch_layers = layers;
        });
    }

    return {
        invoice: invoice.get({ plain: true }) as any,
        totals: {
            product_count: rows.length,
            total_qty: totalQty,
        },
        rows,
    };
};

export const getWarehouseInvoiceQueue = asyncWrapper(async (req: Request, res: Response) => {
    requireInvoicePicklistRoles(req.user?.role);

    const statusRaw = String(req.query?.status || 'ready_to_ship,checked').trim().toLowerCase();
    const statusList = statusRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => ['ready_to_ship', 'checked'].includes(s));
    const q = String(req.query?.q || '').trim();

    const limitRaw = Number(req.query?.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 200;

    const invoices = await Invoice.findAll({
        where: {
            ...(statusList.length > 0 ? { shipment_status: { [Op.in]: statusList } } : {}),
            ...(q ? { invoice_number: { [Op.like]: `%${q}%` } } : {}),
        },
        attributes: ['id', 'invoice_number', 'shipment_status', 'courier_id', 'payment_method', 'payment_status', 'createdAt', 'updatedAt'],
        order: [['createdAt', 'ASC']],
        limit,
    }) as any[];

    const invoiceIds = invoices.map((inv) => String(inv?.id || '')).filter(Boolean);
    const totalsByInvoiceId = new Map<string, { total_qty: number; product_set: Set<string>; order_set: Set<string> }>();
    invoiceIds.forEach((id) => totalsByInvoiceId.set(id, { total_qty: 0, product_set: new Set(), order_set: new Set() }));

    if (invoiceIds.length > 0) {
        const itemRows = await InvoiceItem.findAll({
            where: { invoice_id: { [Op.in]: invoiceIds } },
            attributes: ['invoice_id', 'qty', 'order_item_id'],
            include: [
                {
                    model: OrderItem,
                    attributes: ['order_id', 'product_id'],
                    required: true,
                },
            ],
        }) as any[];

        for (const row of itemRows) {
            const invoiceId = String(row?.invoice_id || '').trim();
            if (!invoiceId) continue;
            const entry = totalsByInvoiceId.get(invoiceId);
            if (!entry) continue;

            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const orderId = String(row?.OrderItem?.order_id || '').trim();
            const productId = String(row?.OrderItem?.product_id || '').trim();
            entry.total_qty += qty;
            if (orderId) entry.order_set.add(orderId);
            if (productId) entry.product_set.add(productId);
        }
    }

    res.json({
        status: statusList.length > 0 ? statusList : undefined,
        q,
        rows: invoices.map((inv) => {
            const plain = inv.get({ plain: true }) as any;
            const id = String(plain?.id || '');
            const totals = totalsByInvoiceId.get(id);
            return {
                id,
                invoice_number: String(plain?.invoice_number || ''),
                shipment_status: String(plain?.shipment_status || ''),
                courier_id: plain?.courier_id ? String(plain.courier_id) : null,
                payment_method: String(plain?.payment_method || ''),
                payment_status: String(plain?.payment_status || ''),
                createdAt: plain?.createdAt || null,
                updatedAt: plain?.updatedAt || null,
                total_qty: Number(totals?.total_qty || 0),
                product_count: Number(totals?.product_set?.size || 0),
                order_count: Number(totals?.order_set?.size || 0),
            };
        }),
    });
});

const buildWarehouseProductPicklist = async (opts: { statuses?: string[]; q?: string; limit?: number }) => {
    const whereStatus = (Array.isArray(opts.statuses) && opts.statuses.length > 0 ? opts.statuses : ['ready_to_ship', 'checked'])
        .map((s) => String(s || '').trim().toLowerCase())
        .filter((s) => ['ready_to_ship', 'checked'].includes(s));
    const q = String(opts.q || '').trim();
    const limitRaw = Number(opts.limit ?? 2000);
    const limit = Number.isFinite(limitRaw) ? Math.min(20000, Math.max(1, Math.trunc(limitRaw))) : 2000;

    const productRows = await sequelize.query(
        `SELECT
            oi.product_id AS product_id,
            p.sku AS sku,
            p.name AS name,
            p.bin_location AS bin_location,
            COUNT(DISTINCT ii.invoice_id) AS invoice_count,
            COUNT(DISTINCT oi.order_id) AS order_count,
            COALESCE(SUM(ii.qty), 0) AS total_qty
         FROM invoice_items ii
         INNER JOIN invoices inv ON inv.id = ii.invoice_id
         INNER JOIN order_items oi ON oi.id = ii.order_item_id
         LEFT JOIN products p ON p.id = oi.product_id
         WHERE inv.shipment_status IN (:statuses)
         GROUP BY oi.product_id, p.sku, p.name, p.bin_location
         ORDER BY p.bin_location ASC, p.sku ASC
         LIMIT :limit`,
        {
            type: QueryTypes.SELECT,
            replacements: { statuses: whereStatus, limit },
        }
    ) as any[];

    const filteredRows = q
        ? (Array.isArray(productRows) ? productRows : []).filter((row: any) => {
            const haystack = [
                row?.sku,
                row?.name,
                row?.bin_location,
                row?.product_id,
            ].map((v) => String(v || '').toLowerCase()).join(' | ');
            return haystack.includes(q.toLowerCase());
        })
        : (Array.isArray(productRows) ? productRows : []);

    const productIds = filteredRows.map((r: any) => String(r?.product_id || '').trim()).filter(Boolean);

    const orderRows = await sequelize.query(
        `SELECT DISTINCT oi.order_id AS order_id
         FROM invoice_items ii
         INNER JOIN invoices inv ON inv.id = ii.invoice_id
         INNER JOIN order_items oi ON oi.id = ii.order_item_id
         WHERE inv.shipment_status IN (:statuses)`,
        {
            type: QueryTypes.SELECT,
            replacements: { statuses: whereStatus },
        }
    ) as any[];
    const orderIds = (Array.isArray(orderRows) ? orderRows : [])
        .map((r: any) => String(r?.order_id || '').trim())
        .filter(Boolean);

    const layersByProductId = new Map<string, Array<{ unit_cost: number; qty_reserved: number }>>();
    if (orderIds.length > 0 && productIds.length > 0) {
        const reservedRows = await sequelize.query(
            `SELECT
                r.product_id AS product_id,
                b.unit_cost AS unit_cost,
                COALESCE(SUM(r.qty_reserved), 0) AS qty_reserved
             FROM inventory_batch_reservations r
             INNER JOIN inventory_batches b ON b.id = r.batch_id
             WHERE r.order_id IN (:orderIds)
               AND r.product_id IN (:productIds)
             GROUP BY r.product_id, b.unit_cost`,
            {
                type: QueryTypes.SELECT,
                replacements: { orderIds, productIds },
            }
        ) as any[];

        (Array.isArray(reservedRows) ? reservedRows : []).forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            const unitCost = Number(row?.unit_cost || 0);
            const qtyReserved = Math.max(0, Math.trunc(Number(row?.qty_reserved || 0)));
            if (!Number.isFinite(unitCost) || unitCost <= 0 || qtyReserved <= 0) return;
            const list = layersByProductId.get(productId) || [];
            list.push({ unit_cost: unitCost, qty_reserved: qtyReserved });
            layersByProductId.set(productId, list);
        });
        layersByProductId.forEach((list, productId) => {
            layersByProductId.set(productId, [...list].sort((a, b) => a.unit_cost - b.unit_cost));
        });
    }

    const rows = filteredRows.map((row: any) => {
        const productId = String(row?.product_id || '').trim();
        const totalQty = Math.max(0, Math.trunc(Number(row?.total_qty || 0)));
        return {
            product_id: productId,
            sku: String(row?.sku || productId || '').trim(),
            name: String(row?.name || 'Produk'),
            bin_location: row?.bin_location ? String(row.bin_location) : null,
            invoice_count: Math.max(0, Math.trunc(Number(row?.invoice_count || 0))),
            order_count: Math.max(0, Math.trunc(Number(row?.order_count || 0))),
            total_qty: totalQty,
            batch_layers: layersByProductId.get(productId) || [],
        };
    });

    const totals = rows.reduce(
        (acc, row) => {
            acc.total_qty += Number(row.total_qty || 0);
            acc.product_count += 1;
            acc.invoice_count += Number(row.invoice_count || 0);
            acc.order_count += Number(row.order_count || 0);
            return acc;
        },
        { total_qty: 0, product_count: 0, invoice_count: 0, order_count: 0 }
    );

    return { status: whereStatus, q, totals, rows };
};

export const getWarehouseProductPicklist = asyncWrapper(async (req: Request, res: Response) => {
    requireInvoicePicklistRoles(req.user?.role);

    const statusRaw = String(req.query?.status || 'ready_to_ship,checked').trim().toLowerCase();
    const statusList = statusRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => ['ready_to_ship', 'checked'].includes(s));
    const result = await buildWarehouseProductPicklist({
        statuses: statusList.length > 0 ? statusList : undefined,
        q: String(req.query?.q || ''),
        limit: Number(req.query?.limit ?? 2000),
    });
    res.json(result);
});

export const exportWarehouseProductPicklistExcel = asyncWrapper(async (req: Request, res: Response) => {
    requireInvoicePicklistRoles(req.user?.role);

    const statusRaw = String(req.query?.status || 'ready_to_ship,checked').trim().toLowerCase();
    const statusList = statusRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => ['ready_to_ship', 'checked'].includes(s));
    const q = String(req.query?.q || '').trim();
    const limitRaw = Number(req.query?.limit ?? 20000);
    const limit = Number.isFinite(limitRaw) ? Math.min(20000, Math.max(1, Math.trunc(limitRaw))) : 20000;

    const payload = await buildWarehouseProductPicklist({
        statuses: statusList.length > 0 ? statusList : undefined,
        q,
        limit,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Migunani System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Picklist Gudang');

    sheet.getRow(1).values = ['Picklist Gudang (Global)'];
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(3).values = ['Status', String((payload.status || []).join(', ') || '-')];
    sheet.getRow(4).values = ['Filter', q || '-'];
    sheet.getRow(5).values = ['Total Qty', Number(payload.totals?.total_qty || 0)];
    sheet.getRow(6).values = ['Total Produk', Number(payload.totals?.product_count || 0)];

    const headerRowIndex = 8;
    sheet.getRow(headerRowIndex).values = ['No', 'Bin', 'SKU', 'Produk', 'Batch (HPP)', 'Qty', 'Invoice', 'Order'];
    sheet.getRow(headerRowIndex).font = { bold: true };

    (payload.rows as any[]).forEach((row: any, idx: number) => {
        const excelRowIndex = headerRowIndex + 1 + idx;
        const layers = Array.isArray(row?.batch_layers) ? row.batch_layers : [];
        const layerText = layers.length > 0
            ? layers
                .filter((l: any) => Number(l?.qty_reserved || 0) > 0)
                .map((l: any) => `${Number(l?.unit_cost || 0)} x ${Math.max(0, Math.trunc(Number(l?.qty_reserved || 0)))}`)
                .join(' | ')
            : 'FIFO (auto)';
        sheet.getRow(excelRowIndex).values = [
            idx + 1,
            row.bin_location || '',
            row.sku || row.product_id || '',
            row.name || '',
            layerText,
            Number(row.total_qty || 0),
            Number(row.invoice_count || 0),
            Number(row.order_count || 0),
        ];
        sheet.getRow(excelRowIndex).getCell(6).numFmt = '#,##0';
        sheet.getRow(excelRowIndex).getCell(7).numFmt = '#,##0';
        sheet.getRow(excelRowIndex).getCell(8).numFmt = '#,##0';
    });

    sheet.columns = [
        { key: 'no', width: 6 },
        { key: 'bin', width: 18 },
        { key: 'sku', width: 18 },
        { key: 'product', width: 44 },
        { key: 'batch', width: 28 },
        { key: 'qty', width: 10 },
        { key: 'inv', width: 10 },
        { key: 'ord', width: 10 },
    ];

    const timestamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
    const fileName = `picklist-gudang-${fileSuffix}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
});

export const getInvoicePicklist = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = String(req.params.id || '').trim();
    if (!invoiceId) throw new CustomError('ID Invoice wajib diisi', 400);
    requireInvoicePicklistRoles(req.user?.role);

    const result = await buildInvoicePicklist(invoiceId);
    res.json({
        invoice_id: String(result.invoice?.id || invoiceId),
        invoice_number: String(result.invoice?.invoice_number || ''),
        createdAt: result.invoice?.createdAt || null,
        shipment_status: String(result.invoice?.shipment_status || ''),
        totals: result.totals,
        rows: result.rows,
    });
});

export const exportInvoicePicklistExcel = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = String(req.params.id || '').trim();
    if (!invoiceId) throw new CustomError('ID Invoice wajib diisi', 400);
    requireInvoicePicklistRoles(req.user?.role);

    const result = await buildInvoicePicklist(invoiceId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Migunani System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Picklist');

    sheet.getRow(1).values = ['Picklist Gudang (Invoice)'];
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.getRow(3).values = ['Invoice', String(result.invoice?.invoice_number || '-')];
    sheet.getRow(4).values = ['Invoice ID', String(result.invoice?.id || invoiceId)];
    sheet.getRow(5).values = ['Total Qty', Number(result.totals?.total_qty || 0)];
    sheet.getRow(6).values = ['Total Produk', Number(result.totals?.product_count || 0)];

    const headerRowIndex = 8;
    sheet.getRow(headerRowIndex).values = ['No', 'Bin', 'SKU', 'Produk', 'Batch (HPP)', 'Qty'];
    sheet.getRow(headerRowIndex).font = { bold: true };

    (Array.isArray(result.rows) ? result.rows : []).forEach((row, idx) => {
        const excelRowIndex = headerRowIndex + 1 + idx;
        const layers = Array.isArray((row as any).batch_layers) ? ((row as any).batch_layers as any[]) : [];
        const layerText = layers.length > 0
            ? layers
                .filter((l) => Number(l?.qty_reserved || 0) > 0)
                .map((l) => `${Number(l?.unit_cost || 0)} x ${Math.max(0, Math.trunc(Number(l?.qty_reserved || 0)))}`)
                .join(' | ')
            : 'FIFO (auto)';
        sheet.getRow(excelRowIndex).values = [
            idx + 1,
            row.bin_location || '',
            row.sku || row.product_id || '',
            row.name || '',
            layerText,
            Number(row.total_qty || 0),
        ];
        sheet.getRow(excelRowIndex).getCell(6).numFmt = '#,##0';
    });

    sheet.columns = [
        { key: 'no', width: 6 },
        { key: 'bin', width: 18 },
        { key: 'sku', width: 18 },
        { key: 'product', width: 44 },
        { key: 'batch', width: 28 },
        { key: 'qty', width: 10 },
    ];

    const timestamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fileSuffix = `${timestamp.getFullYear()}${pad(timestamp.getMonth() + 1)}${pad(timestamp.getDate())}-${pad(timestamp.getHours())}${pad(timestamp.getMinutes())}`;
    const safeInvoiceNumber = String(result.invoice?.invoice_number || 'INV').replace(/[^a-z0-9_-]/gi, '_');
    const fileName = `picklist-${safeInvoiceNumber}-${fileSuffix}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
});
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

    // Ownership: customer must only see their own invoices.
    // Prefer direct invoice.customer_id to avoid heavy/nested join queries that can break under pagination subqueries.
    andClauses.push({ customer_id: userId });

    if (orderId) {
        // Legacy support: some invoices may still reference the primary order in invoices.order_id.
        andClauses.push({ order_id: orderId });
    }

    const whereClause: any = andClauses.length > 0 ? { [Op.and]: andClauses } : {};

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
        limit,
        offset,
        order: orderBy
    });

    const invoices = result.rows.map((row) => {
        const plain = row.get({ plain: true }) as any;
        // Ensure response does not leak join-only include payloads.
        if (plain && typeof plain === 'object' && 'Items' in plain) {
            delete plain.Items;
        }
        return plain;
    });
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

        // Allow customers to upload transfer proof even if delivery is already completed.
        // In that case, we should NOT move order status backwards to waiting_admin_verification.
        const finalOrderStatuses = new Set(['delivered', 'completed', 'partially_fulfilled', 'canceled', 'cancelled']);
        const orderIdsToMarkWaitingVerification: string[] = [];
        for (const row of relatedOrders as any[]) {
            const currentStatus = String(row?.status || '').trim().toLowerCase();
            const orderId = String(row?.id || '').trim();
            if (!orderId) continue;
            if (finalOrderStatuses.has(currentStatus)) {
                continue;
            }
            if (!isOrderTransitionAllowed(currentStatus, 'waiting_admin_verification')) {
                throw new CustomError(
                    `Order ${orderId} tidak bisa masuk status waiting_admin_verification dari status '${currentStatus}'.`,
                    409
                );
            }
            orderIdsToMarkWaitingVerification.push(orderId);
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

        if (orderIdsToMarkWaitingVerification.length > 0) {
            await Order.update(
                { status: 'waiting_admin_verification' },
                { where: { id: { [Op.in]: orderIdsToMarkWaitingVerification } }, transaction: t }
            );
        }

        for (const orderId of relatedOrderIds) {
            const previousStatus = previousStatuses.get(String(orderId)) || '';
            if (orderIdsToMarkWaitingVerification.includes(String(orderId)) && previousStatus !== 'waiting_admin_verification') {
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: String(orderId),
                    invoice_id: invoiceId,
                    from_status: previousStatus || null,
                    to_status: 'waiting_admin_verification',
                    actor_user_id: String(req.user?.id || '').trim() || null,
                    actor_role: String(req.user?.role || '').trim() || null,
                    reason: 'invoice_payment_proof_upload',
                });
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
            throw new CustomError('Hanya super admin / admin gudang yang dapat melakukan penugasan driver.', 403);
        }

        if (!invoiceId) {
            throw new CustomError('ID Invoice wajib diisi', 400);
        }

        if (!courier_id) {
            throw new CustomError('Pilih driver terlebih dahulu', 400);
        }
        const courierId = normalizeNullableUuid(courier_id);
        if (!courierId) {
            throw new CustomError('Driver tidak valid.', 400);
        }

        const invoice = await Invoice.findByPk(invoiceId, {
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!invoice) {
            throw new CustomError('Invoice tidak ditemukan', 404);
        }

        const courier = await User.findOne({
            where: { id: courierId, role: 'driver', status: 'active' },
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
