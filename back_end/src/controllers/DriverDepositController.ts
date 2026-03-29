import { Request, Response } from 'express';
import { Op } from 'sequelize';
import {
    Account,
    Backorder,
    CodCollection,
    CodSettlement,
    DriverBalanceAdjustment,
    Invoice,
    InvoiceItem,
    Order,
    OrderItem,
    Product,
    Retur,
    ReturHandover,
    ReturHandoverItem,
    User,
    sequelize,
} from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { computeInvoiceNetTotalsBulk } from '../utils/invoiceNetTotals';
import { calculateDriverCodExposure } from '../utils/codExposure';
import { isOrderTransitionAllowed } from '../utils/orderTransitions';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../utils/orderNotification';
import { JournalService } from '../services/JournalService';
import { ReturService } from '../services/ReturService';
import { bulkUpdateReturHandoversSafe, findAllReturHandoversSafe, findReturHandoverByPkSafe, updateReturHandoverSafe } from '../utils/returHandoverSchemaCompat';
import { recordOrderStatusChanged } from '../utils/orderEvent';
import { CustomerBalanceService } from '../services/CustomerBalanceService';
import { parseMoneyInput } from '../utils/money';

type DriverDepositCodInvoiceRow = {
    invoice_id: string;
    invoice_number: string;
    expected_total: number;
    created_at: string | null;
    order_ids: string[];
    customer_names: string[];
    requires_retur_handover: boolean;
    pending_handover_id: number | null;
};

type DriverDepositHandoverItemRow = {
    retur_id: string;
    qty: number;
    product?: { id: string; name: string; sku: string; unit: string } | null;
};

type DriverDepositHandoverRow = {
    handover_id: number;
    invoice_id: string;
    status: 'submitted' | 'received';
    submitted_at: string | null;
    note: string | null;
    items: DriverDepositHandoverItemRow[];
};

const toNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const settleOrNetBalanceAdjustments = async (created: DriverBalanceAdjustment, t: any) => {
    const driverId = String(created.driver_id || '').trim();
    const direction = String(created.direction || '').trim().toLowerCase();
    const opposite = direction === 'credit' ? 'debt' : 'credit';
    let remaining = Math.round(toNumber(created.amount) * 100) / 100;

    if (!driverId || remaining <= 0) {
        await created.update({ status: 'settled', amount: 0 }, { transaction: t });
        return;
    }

    const opposites = await DriverBalanceAdjustment.findAll({
        where: { driver_id: driverId, status: 'open', direction: opposite },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE
    });

    for (const row of opposites as any[]) {
        if (remaining <= 0) break;
        const openAmt = Math.round(toNumber(row.amount) * 100) / 100;
        if (openAmt <= 0) {
            await row.update({ status: 'settled', amount: 0 }, { transaction: t });
            continue;
        }
        const offset = Math.min(remaining, openAmt);
        remaining = Math.round((remaining - offset) * 100) / 100;
        const nextOppAmt = Math.round((openAmt - offset) * 100) / 100;
        await row.update(
            nextOppAmt <= 0 ? { status: 'settled', amount: 0 } : { amount: nextOppAmt },
            { transaction: t }
        );
    }

    await created.update(
        remaining <= 0 ? { status: 'settled', amount: 0 } : { amount: remaining },
        { transaction: t }
    );
};

export const getDriverDepositList = asyncWrapper(async (req: Request, res: Response) => {
    const drivers = await User.findAll({
        where: { role: 'driver' },
        attributes: ['id', 'name', 'whatsapp_number', 'debt']
    });
    const driverById = new Map<string, any>();
    drivers.forEach((d: any) => driverById.set(String(d.id), d));

    // COD invoices pending (latest invoice per order to avoid stale duplicates)
    // IMPORTANT: keep this query filtered to avoid loading the entire invoice_items table into memory.
    const allInvoiceItems = await InvoiceItem.findAll({
        attributes: ['invoice_id', 'order_item_id'],
        include: [{
            model: Invoice,
            required: true,
            attributes: ['id', 'invoice_number', 'courier_id', 'payment_method', 'payment_status', 'createdAt'],
            where: {
                payment_method: 'cod',
                payment_status: 'cod_pending',
            }
        }, {
            model: OrderItem,
            required: true,
            attributes: ['order_id']
        }]
    });

    const latestInvoiceByOrderId = new Map<string, any>();
    allInvoiceItems.forEach((row: any) => {
        const orderId = row?.OrderItem?.order_id ? String(row.OrderItem.order_id) : '';
        const inv = row?.Invoice;
        if (!orderId || !inv) return;
        const t = new Date(String(inv.createdAt || 0)).getTime();
        const prev = latestInvoiceByOrderId.get(orderId);
        const prevT = prev ? new Date(String(prev.createdAt || 0)).getTime() : -1;
        if (!prev || t > prevT) {
            latestInvoiceByOrderId.set(orderId, inv);
        }
    });

    const invoiceIds: string[] = [];
    latestInvoiceByOrderId.forEach((inv) => {
        const id = String(inv?.id || '').trim();
        if (id) invoiceIds.push(id);
    });
    const uniqueInvoiceIds = Array.from(new Set(invoiceIds));

    const netTotalsByInvoiceId = uniqueInvoiceIds.length > 0
        ? await computeInvoiceNetTotalsBulk(uniqueInvoiceIds)
        : new Map<string, any>();

    const pendingHandovers = uniqueInvoiceIds.length > 0
        ? await ReturHandover.findAll({
            where: { status: 'submitted', invoice_id: { [Op.in]: uniqueInvoiceIds } },
            attributes: ['id', 'invoice_id', 'driver_id', 'status']
        })
        : [];
    const pendingHandoverByInvoiceId = new Map<string, any>();
    pendingHandovers.forEach((h: any) => {
        pendingHandoverByInvoiceId.set(String(h.invoice_id), h);
    });

    const invoiceMetaById = new Map<string, any>();
    latestInvoiceByOrderId.forEach((inv) => {
        const id = String(inv?.id || '').trim();
        if (!id) return;
        invoiceMetaById.set(id, inv);
    });

    // Build invoice -> order_ids & customer_names in bulk
    const invoiceOrderRows = uniqueInvoiceIds.length > 0
        ? await InvoiceItem.findAll({
            where: { invoice_id: { [Op.in]: uniqueInvoiceIds } },
            attributes: ['invoice_id'],
            include: [{
                model: OrderItem,
                required: true,
                attributes: ['order_id'],
                include: [{
                    model: Order,
                    required: true,
                    attributes: ['id', 'courier_id'],
                    include: [{
                        model: User,
                        as: 'Customer',
                        attributes: ['name'],
                        required: false
                    }]
                }]
            }]
        })
        : [];

    const invoiceOrderIds = new Map<string, Set<string>>();
    const invoiceCustomerNames = new Map<string, Set<string>>();
    const invoiceDriverId = new Map<string, string>();
    invoiceOrderRows.forEach((row: any) => {
        const invId = String(row?.invoice_id || '').trim();
        const orderId = String(row?.OrderItem?.order_id || '').trim();
        const courierId = String(row?.OrderItem?.Order?.courier_id || '').trim();
        const customerName = String(row?.OrderItem?.Order?.Customer?.name || '').trim();
        if (!invId || !orderId) return;
        const orders = invoiceOrderIds.get(invId) || new Set<string>();
        orders.add(orderId);
        invoiceOrderIds.set(invId, orders);
        if (customerName) {
            const names = invoiceCustomerNames.get(invId) || new Set<string>();
            names.add(customerName);
            invoiceCustomerNames.set(invId, names);
        }
        if (courierId && !invoiceDriverId.get(invId)) {
            invoiceDriverId.set(invId, courierId);
        }
    });

    const codRowsByDriverId = new Map<string, DriverDepositCodInvoiceRow[]>();
    uniqueInvoiceIds.forEach((invId) => {
        const meta = invoiceMetaById.get(invId);
        const driverId = String(meta?.courier_id || invoiceDriverId.get(invId) || '').trim();
        if (!driverId) return;
        const expected = toNumber(netTotalsByInvoiceId.get(invId)?.net_total);
        const pendingHandover = pendingHandoverByInvoiceId.get(invId);
        const row: DriverDepositCodInvoiceRow = {
            invoice_id: invId,
            invoice_number: String(meta?.invoice_number || '').trim(),
            expected_total: Math.round(expected * 100) / 100,
            created_at: meta?.createdAt ? new Date(String(meta.createdAt)).toISOString() : null,
            order_ids: Array.from(invoiceOrderIds.get(invId) || []),
            customer_names: Array.from(invoiceCustomerNames.get(invId) || []),
            requires_retur_handover: Boolean(pendingHandover),
            pending_handover_id: pendingHandover ? Number(pendingHandover.id) : null
        };
        const list = codRowsByDriverId.get(driverId) || [];
        list.push(row);
        codRowsByDriverId.set(driverId, list);
    });

    const handoverFindArgs: any = {
        where: { status: 'submitted' },
        include: [{
            model: ReturHandoverItem,
            as: 'Items',
            include: [{
                model: Retur,
                as: 'Retur',
                include: [{ model: Product, attributes: ['id', 'name', 'sku', 'unit'] }]
            }]
        }],
        order: [['submitted_at', 'DESC'], ['id', 'DESC']]
    };

    const handovers: any[] = await findAllReturHandoversSafe(handoverFindArgs);
    const handoversByDriverId = new Map<string, DriverDepositHandoverRow[]>();
    handovers.forEach((handover: any) => {
        const driverId = String(handover?.driver_id || '').trim();
        if (!driverId) return;
        const items = Array.isArray(handover?.Items) ? handover.Items : [];
        const mappedItems: DriverDepositHandoverItemRow[] = items.map((it: any) => {
            const retur = it?.Retur;
            const product = retur?.Product;
            return {
                retur_id: String(it?.retur_id || retur?.id || '').trim(),
                qty: Math.max(0, Math.trunc(toNumber(retur?.qty))),
                product: product ? {
                    id: String(product.id),
                    name: String(product.name || ''),
                    sku: String(product.sku || ''),
                    unit: String(product.unit || ''),
                } : null
            };
        }).filter((x: any) => x.retur_id);
        const row: DriverDepositHandoverRow = {
            handover_id: Number(handover.id),
            invoice_id: String(handover.invoice_id || ''),
            status: String(handover.status || 'submitted') as any,
            submitted_at: handover.submitted_at ? new Date(String(handover.submitted_at)).toISOString() : null,
            note: typeof handover.note === 'string' ? handover.note : null,
            items: mappedItems
        };
        const list = handoversByDriverId.get(driverId) || [];
        list.push(row);
        handoversByDriverId.set(driverId, list);
    });

    const response: any[] = [];
    const driverIds = new Set<string>([
        ...Array.from(codRowsByDriverId.keys()),
        ...Array.from(handoversByDriverId.keys()),
    ]);
    driverIds.forEach((driverId) => {
        const d = driverById.get(driverId);
        if (!d) return;
        const codRows = (codRowsByDriverId.get(driverId) || []).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        const hRows = (handoversByDriverId.get(driverId) || []).sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
        response.push({
            driver: {
                id: String(d.id),
                name: String(d.name || ''),
                whatsapp_number: String(d.whatsapp_number || ''),
                debt: toNumber(d.debt),
            },
            cod_invoices_pending: codRows,
            retur_handovers_pending: hRows,
            totals: {
                cod_invoice_count: codRows.length,
                cod_expected_total: Math.round(codRows.reduce((sum, r) => sum + toNumber(r.expected_total), 0) * 100) / 100,
                handover_count: hRows.length,
                retur_item_count: hRows.reduce((sum, h) => sum + (Array.isArray(h.items) ? h.items.length : 0), 0),
            }
        });
    });

    return res.json(response);
});

export const getDriverDepositHistory = asyncWrapper(async (req: Request, res: Response) => {
    const driverId = typeof req.query?.driver_id === 'string' ? req.query.driver_id.trim() : '';
    const rawFrom = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
    const rawTo = typeof req.query?.to === 'string' ? req.query.to.trim() : '';
    const includeStatus = typeof req.query?.include_status === 'string' ? req.query.include_status.trim().toLowerCase() : 'all';
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50) || 50));
    const offset = Math.max(0, Number(req.query?.offset || 0) || 0);

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const parsedFrom = rawFrom ? new Date(rawFrom) : defaultFrom;
    const parsedTo = rawTo ? new Date(rawTo) : now;
    const from = Number.isFinite(parsedFrom.getTime()) ? parsedFrom : defaultFrom;
    const to = Number.isFinite(parsedTo.getTime()) ? parsedTo : now;

    const settlementWhere: any = {
        settled_at: { [Op.between]: [from, to] }
    };
    if (driverId) settlementWhere.driver_id = driverId;

    const handoverWhere: any = {};
    if (driverId) handoverWhere.driver_id = driverId;
    if (includeStatus === 'submitted' || includeStatus === 'received') {
        handoverWhere.status = includeStatus;
    }
    handoverWhere[Op.or] = [
        { submitted_at: { [Op.between]: [from, to] } },
        { received_at: { [Op.between]: [from, to] } },
    ];

    const codSettlements = await CodSettlement.findAll({
        where: settlementWhere,
        include: [
            { model: User, as: 'Driver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
            { model: User, as: 'Receiver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
        ],
        order: [['settled_at', 'DESC'], ['id', 'DESC']],
        limit,
        offset,
    });

    const historyHandoverFindArgs: any = {
        where: handoverWhere,
        include: [
            { model: User, as: 'Driver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
            { model: User, as: 'Receiver', attributes: ['id', 'name', 'whatsapp_number'], required: false },
            {
                model: ReturHandoverItem,
                as: 'Items',
                include: [{
                    model: Retur,
                    as: 'Retur',
                    attributes: ['id', 'qty', 'qty_received', 'status', 'retur_type', 'product_id'],
                    include: [{ model: Product, attributes: ['id', 'name', 'sku', 'unit'] }]
                }]
            }
        ],
        order: [[sequelize.fn('COALESCE', sequelize.col('received_at'), sequelize.col('submitted_at')), 'DESC'], ['id', 'DESC']],
        limit,
        offset,
    };

    const handovers: any[] = await findAllReturHandoversSafe(historyHandoverFindArgs);

    const safeParseInvoiceIds = (value: unknown): string[] => {
        if (typeof value !== 'string' || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed)) return [];
            return parsed.map((x) => String(x || '').trim()).filter(Boolean);
        } catch {
            return [];
        }
    };

    const settlementIds = codSettlements.map((s: any) => Number(s.id)).filter((x) => Number.isFinite(x) && x > 0);
    const settlementInvoiceIdsBySettlementId = new Map<number, string[]>();

    codSettlements.forEach((s: any) => {
        const ids = safeParseInvoiceIds(s.invoice_ids_json);
        if (ids.length > 0) settlementInvoiceIdsBySettlementId.set(Number(s.id), ids);
    });

    const missingLinkSettlementIds = settlementIds.filter((id) => !(settlementInvoiceIdsBySettlementId.get(id)?.length));
    if (missingLinkSettlementIds.length > 0) {
        const rows = await CodCollection.findAll({
            where: { settlement_id: { [Op.in]: missingLinkSettlementIds } },
            attributes: ['settlement_id', 'invoice_id'],
        });
        rows.forEach((row: any) => {
            const sid = Number(row?.settlement_id);
            const invId = String(row?.invoice_id || '').trim();
            if (!Number.isFinite(sid) || sid <= 0 || !invId) return;
            const bucket = settlementInvoiceIdsBySettlementId.get(sid) || [];
            bucket.push(invId);
            settlementInvoiceIdsBySettlementId.set(sid, bucket);
        });
    }

    const allInvoiceIds = Array.from(new Set(
        Array.from(settlementInvoiceIdsBySettlementId.values()).flat().map((x) => String(x || '').trim()).filter(Boolean)
    ));
    const invoices = allInvoiceIds.length > 0
        ? await Invoice.findAll({
            where: { id: { [Op.in]: allInvoiceIds } },
            attributes: ['id', 'invoice_number', 'customer_id'],
        })
        : [];
    const invoiceById = new Map<string, any>();
    invoices.forEach((inv: any) => invoiceById.set(String(inv.id), inv));

    const customerIds = Array.from(new Set(
        invoices.map((inv: any) => String(inv.customer_id || '').trim()).filter(Boolean)
    ));
    const customers = customerIds.length > 0
        ? await User.findAll({ where: { id: { [Op.in]: customerIds } }, attributes: ['id', 'name'] })
        : [];
    const customerById = new Map<string, any>();
    customers.forEach((u: any) => customerById.set(String(u.id), u));

    const cod = codSettlements.map((s: any) => {
        const sid = Number(s.id);
        const invIds = settlementInvoiceIdsBySettlementId.get(sid) || [];
        const invoiceRows = invIds.map((invId) => {
            const inv = invoiceById.get(invId);
            const custId = inv ? String(inv.customer_id || '').trim() : '';
            const cust = custId ? customerById.get(custId) : null;
            return {
                invoice_id: invId,
                invoice_number: inv ? String(inv.invoice_number || '') : '',
                customer: cust ? { id: String(cust.id), name: String(cust.name || '') } : null,
            };
        });
        return {
            id: sid,
            settled_at: s.settled_at ? new Date(s.settled_at).toISOString() : null,
            driver: (s as any).Driver ? (s as any).Driver.get({ plain: true }) : null,
            receiver: (s as any).Receiver ? (s as any).Receiver.get({ plain: true }) : null,
            total_expected: toNumber((s as any).total_expected),
            amount_received: toNumber((s as any).total_amount),
            diff_amount: toNumber((s as any).diff_amount),
            driver_debt_before: toNumber((s as any).driver_debt_before),
            driver_debt_after: toNumber((s as any).driver_debt_after),
            invoices: invoiceRows,
        };
    });

    const handoverRows = handovers.map((h: any) => {
        const items = Array.isArray(h?.Items) ? h.Items : [];
        return {
            id: Number(h.id),
            invoice_id: String(h.invoice_id || ''),
            status: String(h.status || ''),
            submitted_at: h.submitted_at ? new Date(h.submitted_at).toISOString() : null,
            received_at: h.received_at ? new Date(h.received_at).toISOString() : null,
            driver: (h as any).Driver ? (h as any).Driver.get({ plain: true }) : null,
            receiver: (h as any).Receiver ? (h as any).Receiver.get({ plain: true }) : null,
            note: typeof h.note === 'string' ? h.note : null,
            driver_debt_before: toNumber((h as any).driver_debt_before),
            driver_debt_after: toNumber((h as any).driver_debt_after),
            items: items.map((it: any) => {
                const retur = it?.Retur;
                const product = retur?.Product;
                return {
                    retur_id: String(it?.retur_id || retur?.id || ''),
                    qty: toNumber(retur?.qty),
                    qty_received: Number.isFinite(Number(retur?.qty_received)) ? Math.trunc(Number(retur.qty_received)) : null,
                    product: product ? {
                        id: String(product.id || ''),
                        name: String(product.name || ''),
                        sku: String(product.sku || ''),
                        unit: String(product.unit || ''),
                    } : null
                };
            })
        };
    });

    return res.json({
        meta: {
            driver_id: driverId || null,
            from: from.toISOString(),
            to: to.toISOString(),
            include_status: includeStatus,
            limit,
            offset,
        },
        cod_settlements: cod,
        retur_handovers: handoverRows,
    });
});

export const confirmDriverDeposit = asyncWrapper(async (req: Request, res: Response) => {
    const actor = { id: String(req.user!.id), role: String(req.user!.role) };
    const driverId = String(req.body?.driver_id || '').trim();
    const cod = req.body?.cod;
    const handovers = Array.isArray(req.body?.handovers) ? req.body.handovers : [];

    if (!driverId) throw new CustomError('driver_id wajib diisi', 400);
    if ((!cod || !Array.isArray(cod?.invoice_ids) || cod.invoice_ids.length === 0) && handovers.length === 0) {
        throw new CustomError('Tidak ada data COD atau handover yang diproses', 400);
    }

    const t = await sequelize.transaction();
    try {
        const driver = await User.findByPk(driverId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!driver || String(driver.role || '') !== 'driver') {
            await t.rollback();
            throw new CustomError('Driver tidak ditemukan', 404);
        }

        const driverDebtBefore = toNumber(driver.debt);

        const processedHandoverIds: number[] = [];
        const processedReturIds: string[] = [];
        if (handovers.length > 0) {
            for (const raw of handovers) {
                const handoverId = Number(raw?.handover_id);
                if (!Number.isFinite(handoverId) || handoverId <= 0) {
                    await t.rollback();
                    throw new CustomError('handover_id tidak valid', 400);
                }
                const note = typeof raw?.note === 'string' ? raw.note.trim() : null;
                const items = Array.isArray(raw?.items) ? raw.items : [];
                if (items.length === 0) {
                    await t.rollback();
                    throw new CustomError('items wajib diisi untuk menerima handover', 400);
                }

                const handover = await findReturHandoverByPkSafe(handoverId, {
                    include: [{ model: ReturHandoverItem, as: 'Items', attributes: ['retur_id'] }],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                if (!handover) {
                    await t.rollback();
                    throw new CustomError('Handover tidak ditemukan', 404);
                }
                if (String(handover.driver_id || '') !== driverId) {
                    await t.rollback();
                    throw new CustomError('Handover bukan milik driver ini', 403);
                }
                if (String(handover.status || '') !== 'submitted') {
                    await t.rollback();
                    throw new CustomError('Handover sudah diterima sebelumnya', 409);
                }

                const expectedReturIds = new Set<string>(
                    ((handover as any)?.Items || []).map((r: any) => String(r?.retur_id || '').trim()).filter(Boolean)
                );
                if (expectedReturIds.size === 0) {
                    await t.rollback();
                    throw new CustomError('Handover tidak memiliki retur item', 409);
                }

                const receivedByReturId = new Map<string, number>();
                for (const row of items) {
                    const returId = String(row?.retur_id || '').trim();
                    const qtyReceived = Number(row?.qty_received);
                    if (!returId) {
                        await t.rollback();
                        throw new CustomError('retur_id wajib diisi', 400);
                    }
                    if (!expectedReturIds.has(returId)) {
                        await t.rollback();
                        throw new CustomError('retur_id tidak termasuk handover ini', 409);
                    }
                    if (!Number.isFinite(qtyReceived) || qtyReceived < 0) {
                        await t.rollback();
                        throw new CustomError('qty_received tidak valid', 400);
                    }
                    receivedByReturId.set(returId, Math.trunc(qtyReceived));
                }
                if (receivedByReturId.size !== expectedReturIds.size) {
                    await t.rollback();
                    throw new CustomError('qty_received wajib diisi untuk semua retur dalam handover', 400);
                }

                for (const returId of expectedReturIds) {
                    const qtyReceived = receivedByReturId.get(returId) || 0;
                    await ReturService.updateReturStatus(returId, {
                        status: 'received',
                        qty_received: qtyReceived
                    } as any, actor, { transaction: t });
                    await ReturService.updateReturStatus(returId, {
                        status: 'completed',
                        is_back_to_stock: true
                    } as any, actor, { transaction: t });
                    processedReturIds.push(returId);
                }

                await updateReturHandoverSafe(handover, {
                    status: 'received',
                    received_at: new Date(),
                    received_by: actor.id,
                    note: note || (handover as any).note || null,
                    driver_debt_before: driverDebtBefore,
                }, { transaction: t });

                processedHandoverIds.push(handoverId);
            }
        }

        let settlementId: string | null = null;
        let totalExpected = 0;
        let amountReceived = 0;
        let codDiff = 0;
        let settledInvoiceIds: string[] = [];
        let settledOrderIds: string[] = [];
        let createdAdjustment: any = null;

        if (cod && Array.isArray(cod?.invoice_ids) && cod.invoice_ids.length > 0) {
            const invoiceIds = Array.from(new Set((cod.invoice_ids as any[]).map((v) => String(v).trim()).filter(Boolean)));
            const receivedParsed = parseMoneyInput(cod?.amount_received);
            if (receivedParsed === null || receivedParsed < 0) {
                await t.rollback();
                throw new CustomError('amount_received tidak valid', 400);
            }
            amountReceived = Math.round(receivedParsed * 100) / 100;

            // Block if any selected invoice still has pending retur handover
            const pending = await findAllReturHandoversSafe({
                where: { invoice_id: { [Op.in]: invoiceIds }, status: 'submitted' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (pending.length > 0) {
                await t.rollback();
                throw new CustomError('Tidak bisa menyelesaikan COD: masih ada retur handover yang belum diterima untuk invoice terpilih.', 409);
            }

            const invoices = await Invoice.findAll({
                where: { id: { [Op.in]: invoiceIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (invoices.length !== invoiceIds.length) {
                await t.rollback();
                throw new CustomError('Beberapa invoice tidak ditemukan', 404);
            }
            invoices.forEach((inv: any) => {
                const method = String(inv.payment_method || '').trim().toLowerCase();
                const status = String(inv.payment_status || '').trim().toLowerCase();
                if (method !== 'cod' || status !== 'cod_pending') {
                    throw new CustomError('Invoice yang dipilih harus COD dengan status cod_pending', 409);
                }
            });

            const netTotals = await computeInvoiceNetTotalsBulk(invoiceIds, { transaction: t });
            totalExpected = Math.round(invoiceIds.reduce((sum, id) => sum + toNumber(netTotals.get(id)?.net_total), 0) * 100) / 100;
            codDiff = Math.round((amountReceived - totalExpected) * 100) / 100;

            // Determine affected orders for status updates + driver ownership
            const invoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: invoiceIds } },
                include: [{
                    model: OrderItem,
                    required: true,
                    attributes: ['order_id'],
                }],
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const orderIds = Array.from(new Set(invoiceItems.map((it: any) => String(it?.OrderItem?.order_id || '').trim()).filter(Boolean)));
            if (orderIds.length === 0) {
                await t.rollback();
                throw new CustomError('Invoice tidak memiliki order untuk diselesaikan', 409);
            }

            const orders = await Order.findAll({
                where: { id: { [Op.in]: orderIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            orders.forEach((o: any) => {
                if (String(o.courier_id || '') !== driverId) {
                    throw new CustomError('Invoice hanya bisa diselesaikan oleh driver yang sama.', 409);
                }
            });

            // Create settlement
            const settlement = await CodSettlement.create({
                driver_id: driverId,
                total_amount: amountReceived,
                total_expected: totalExpected,
                diff_amount: codDiff,
                driver_debt_before: driverDebtBefore,
                invoice_ids_json: JSON.stringify(invoiceIds),
                received_by: actor.id,
                settled_at: new Date()
            }, { transaction: t });
            settlementId = String(settlement.id);

            // Mark collections settled (if any)
            const collections = await CodCollection.findAll({
                where: { invoice_id: { [Op.in]: invoiceIds }, driver_id: driverId, status: 'collected' },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (collections.length > 0) {
                await CodCollection.update({
                    status: 'settled',
                    settlement_id: settlement.id
                }, {
                    where: { id: { [Op.in]: collections.map((c: any) => c.id) } },
                    transaction: t
                });
            }

            // Allocate COD diff to customer balance entries (pro-rata by expected net total per invoice)
            if (codDiff !== 0) {
                const invoiceItemsForCustomer = await InvoiceItem.findAll({
                    where: { invoice_id: { [Op.in]: invoiceIds } },
                    attributes: ['invoice_id'],
                    include: [{
                        model: OrderItem,
                        required: true,
                        attributes: ['order_id'],
                    }],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });

                const orderCustomerById = new Map<string, string>();
                orders.forEach((o: any) => {
                    const orderId = String(o?.id || '').trim();
                    const customerId = String(o?.customer_id || '').trim();
                    if (orderId && customerId) orderCustomerById.set(orderId, customerId);
                });

                const orderIdsByInvoiceId = new Map<string, Set<string>>();
                invoiceItemsForCustomer.forEach((row: any) => {
                    const invoiceId = String(row?.invoice_id || '').trim();
                    const orderId = String(row?.OrderItem?.order_id || '').trim();
                    if (!invoiceId || !orderId) return;
                    if (!orderIdsByInvoiceId.has(invoiceId)) orderIdsByInvoiceId.set(invoiceId, new Set());
                    orderIdsByInvoiceId.get(invoiceId)!.add(orderId);
                });

                const customerByInvoiceId = new Map<string, string>();
                const missingCustomerInvoices: string[] = [];
                const multiCustomerInvoices: string[] = [];
                for (const invoiceId of invoiceIds) {
                    const orderIdsForInvoice = Array.from(orderIdsByInvoiceId.get(invoiceId) || []);
                    const customerIds = Array.from(new Set(orderIdsForInvoice.map((oid) => orderCustomerById.get(oid)).filter(Boolean) as string[]));
                    if (customerIds.length === 0) {
                        missingCustomerInvoices.push(invoiceId);
                        continue;
                    }
                    if (customerIds.length > 1) {
                        multiCustomerInvoices.push(invoiceId);
                        continue;
                    }
                    customerByInvoiceId.set(invoiceId, customerIds[0]!);
                }
                if (missingCustomerInvoices.length > 0) {
                    await t.rollback();
                    throw new CustomError(`COD settlement gagal: tidak bisa resolve customer untuk invoice: ${missingCustomerInvoices.join(', ')}`, 409);
                }
                if (multiCustomerInvoices.length > 0) {
                    await t.rollback();
                    throw new CustomError(`COD settlement gagal: 1 invoice berisi lebih dari 1 customer: ${multiCustomerInvoices.join(', ')}`, 409);
                }

                const weightsByCustomerId = new Map<string, number>();
                for (const invoiceId of invoiceIds) {
                    const customerId = customerByInvoiceId.get(invoiceId);
                    if (!customerId) continue;
                    const expectedNet = Math.max(0, toNumber(netTotals.get(invoiceId)?.net_total));
                    weightsByCustomerId.set(customerId, (weightsByCustomerId.get(customerId) || 0) + expectedNet);
                }

                const allocations = CustomerBalanceService.allocateDiffProRata(codDiff, weightsByCustomerId);
                for (const [customerId, amount] of allocations.entries()) {
                    if (!amount) continue;
                    await CustomerBalanceService.createEntry({
                        customer_id: customerId,
                        amount,
                        entry_type: 'cod_settlement_delta',
                        reference_type: 'cod_settlement',
                        reference_id: String(settlement.id),
                        created_by: actor.id,
                        note: `Selisih COD settlement #${settlement.id}: expected=${totalExpected}, received=${amountReceived}, diff=${codDiff}.`,
                        idempotency_key: `balance_cod_settlement_${settlement.id}_${customerId}`,
                    }, { transaction: t });
                }
            }

            await Invoice.update({
                payment_status: 'paid',
                verified_at: new Date(),
                verified_by: actor.id
            }, { where: { id: { [Op.in]: invoiceIds } }, transaction: t });

            const previousStatusByOrderId: Record<string, string> = {};
            orders.forEach((o: any) => { previousStatusByOrderId[String(o.id)] = String(o.status || ''); });

            const finalizedOrderResults: Array<{ orderId: string; previousStatus: string; nextStatus: 'completed' | 'partially_fulfilled' }> = [];
            for (const order of orders as any[]) {
                const orderId = String(order.id);
                const prevStatus = String(order.status || '').trim().toLowerCase();

                const orderItems = await OrderItem.findAll({
                    where: { order_id: orderId },
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
                const nextStatus: 'completed' | 'partially_fulfilled' = openBackorderCount > 0 ? 'partially_fulfilled' : 'completed';
                if (prevStatus !== nextStatus) {
                    if (!isOrderTransitionAllowed(prevStatus, nextStatus)) {
                        throw new CustomError(`Transisi status tidak diizinkan: '${prevStatus}' -> '${nextStatus}'`, 409);
                    }
                    finalizedOrderResults.push({ orderId, previousStatus: prevStatus, nextStatus });
                }
            }
            for (const row of finalizedOrderResults) {
                await Order.update({ status: row.nextStatus }, { where: { id: row.orderId }, transaction: t });
            }

            // Journal Entry for Settlement (Cash vs Piutang Driver, diff goes to customer balances)
            {
                const cashAcc = await Account.findOne({ where: { code: '1101' }, transaction: t });
                const piutangDriverAcc = await Account.findOne({ where: { code: '1104' }, transaction: t });
                const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
                const customerSaldoAcc = await Account.findOne({ where: { code: '2105' }, transaction: t });

                const expected = Math.max(0, Math.round(totalExpected * 100) / 100);
                const received = Math.max(0, Math.round(amountReceived * 100) / 100);
                const shortage = Math.max(0, Math.round((expected - received) * 100) / 100);
                const surplus = Math.max(0, Math.round((received - expected) * 100) / 100);

                if (cashAcc && piutangDriverAcc && expected > 0) {
                    const lines: any[] = [];
                    if (received > 0) lines.push({ account_id: cashAcc.id, debit: received, credit: 0 });
                    if (shortage > 0 && arAcc) lines.push({ account_id: arAcc.id, debit: shortage, credit: 0 });
                    lines.push({ account_id: piutangDriverAcc.id, debit: 0, credit: expected });
                    if (surplus > 0 && customerSaldoAcc) lines.push({ account_id: customerSaldoAcc.id, debit: 0, credit: surplus });

                    if (lines.length >= 2) {
                        await JournalService.createEntry({
                            description: `COD Settlement #${settlement.id} (Driver: ${String(driver.name || '')})`,
                            reference_type: 'cod_settlement',
                            reference_id: String(settlement.id),
                            created_by: actor.id,
                            idempotency_key: `cod_settlement_balance_${settlement.id}`,
                            lines
                        }, t);
                    }
                }
            }

            createdAdjustment = null;

            // Recompute driver debt snapshot
            const exposure = await calculateDriverCodExposure(driverId, { transaction: t });
            await driver.update({ debt: exposure.exposure }, { transaction: t });
            const driverDebtAfter = toNumber((driver as any).debt);

            await settlement.update({ driver_debt_after: driverDebtAfter }, { transaction: t });
            if (processedHandoverIds.length > 0) {
                await bulkUpdateReturHandoversSafe(
                    { driver_debt_after: driverDebtAfter },
                    { where: { id: { [Op.in]: processedHandoverIds } }, transaction: t }
                );
            }

            for (const row of finalizedOrderResults) {
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: row.orderId,
                    from_status: previousStatusByOrderId[row.orderId] || null,
                    to_status: row.nextStatus,
                    actor_user_id: actor.id,
                    actor_role: actor.role,
                    reason: 'driver_deposit_cod_settlement',
                });
                await emitOrderStatusChanged({
                    order_id: row.orderId,
                    from_status: previousStatusByOrderId[row.orderId] || null,
                    to_status: row.nextStatus,
                    source: '',
                    payment_method: 'cod',
                    courier_id: driverId,
                    triggered_by_role: actor.role,
                    target_roles: row.nextStatus === 'completed'
                        ? ['admin_finance', 'driver', 'customer']
                        : ['admin_finance', 'driver', 'customer', 'kasir', 'admin_gudang'],
                    target_user_ids: [driverId],
                }, { transaction: t, requestContext: 'admin_driver_deposit_cod_status_changed' } as any);
            }

            await emitCodSettlementUpdated({
                driver_id: driverId,
                order_ids: orderIds,
                invoice_ids: invoiceIds,
                total_expected: totalExpected,
                amount_received: amountReceived,
                driver_debt_before: driverDebtBefore,
                driver_debt_after: driverDebtAfter,
                settled_at: new Date().toISOString(),
                triggered_by_role: actor.role,
                target_roles: ['kasir', 'super_admin', 'driver'],
                target_user_ids: [driverId],
            }, { transaction: t, requestContext: 'admin_driver_deposit_cod_settlement_updated' } as any);

            settledInvoiceIds = invoiceIds;
            settledOrderIds = orderIds;
        } else {
            // even without COD, handover completion can change debt exposure via adjustments
            const exposure = await calculateDriverCodExposure(driverId, { transaction: t });
            await driver.update({ debt: exposure.exposure }, { transaction: t });
            const driverDebtAfter = toNumber((driver as any).debt);
            if (processedHandoverIds.length > 0) {
                await bulkUpdateReturHandoversSafe(
                    { driver_debt_after: driverDebtAfter },
                    { where: { id: { [Op.in]: processedHandoverIds } }, transaction: t }
                );
            }
        }

        await emitAdminRefreshBadges({ transaction: t, requestContext: 'admin_driver_deposit_refresh_badges' } as any);

        await t.commit();

        const driverAfter = await User.findByPk(driverId, { attributes: ['id', 'debt'] });
        return res.json({
            message: 'Setoran Driver berhasil diproses',
            driver_id: driverId,
            cod: settledInvoiceIds.length > 0 ? {
                settlement_id: settlementId,
                invoice_ids: settledInvoiceIds,
                order_ids: settledOrderIds,
                total_expected: totalExpected,
                amount_received: amountReceived,
                diff: codDiff,
                adjustment: createdAdjustment ? {
                    id: String((createdAdjustment as any).id),
                    direction: String((createdAdjustment as any).direction),
                    amount_open: toNumber((createdAdjustment as any).amount),
                    status: String((createdAdjustment as any).status),
                } : null
            } : null,
            handovers: processedHandoverIds.length > 0 ? {
                handover_ids: processedHandoverIds,
                retur_ids: processedReturIds
            } : null,
            driver_debt_before: driverDebtBefore,
            driver_debt_after: toNumber((driverAfter as any)?.debt),
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal memproses setoran driver', 500);
    }
});
