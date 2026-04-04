import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize, Invoice, InvoiceItem, Order, OrderItem, Backorder, DeliveryHandover, DeliveryHandoverItem, OrderIssue, Product, OrderAllocation } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { findOrderIdsByInvoiceId } from '../utils/invoiceLookup';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { recordOrderEvent, recordOrderStatusChanged } from '../utils/orderEvent';
import { isOrderTransitionAllowed } from '../utils/orderTransitions';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { normalizeNullableUuid } from '../utils/uuid';
import { InventoryReservationService } from '../services/InventoryReservationService';

type RawHandoverItemInput = {
    product_id?: unknown;
    qty_checked?: unknown;
    condition?: unknown;
    note?: unknown;
};

const normalizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const toIntNonNegative = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    if (i < 0) return null;
    return i;
};

const parseItemsFromBody = (raw: unknown): RawHandoverItemInput[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as any[];
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const parseEvidenceMap = (raw: unknown): Record<string, number> => {
    if (!raw) return {};
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as any;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as any : {};
        } catch {
            return {};
        }
    }
    return {};
};

const resolveCheckResult = (raw: unknown): 'pass' | 'fail' => {
    const value = normalizeText(raw).toLowerCase();
    if (value === 'fail' || value === 'failed') return 'fail';
    return 'pass';
};

const ISSUE_SLA_MS = 24 * 60 * 60 * 1000;

export const checkInvoice = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const invoiceId = normalizeText(req.body?.invoice_id);
        const note = normalizeText(req.body?.note) || null;
        const checkResult = resolveCheckResult(req.body?.result);
        const files = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
        const headerEvidence = ((req as any).file as Express.Multer.File | undefined)
            || (Array.isArray(files?.evidence) ? files?.evidence?.[0] : undefined);
        const itemEvidenceFiles = Array.isArray(files?.item_evidences) ? files?.item_evidences : [];
        const evidenceMapRaw = parseEvidenceMap(req.body?.item_evidence_map);
        const evidenceIndexByProductId = new Map<string, number>();
        Object.entries(evidenceMapRaw || {}).forEach(([productId, idx]) => {
            const key = normalizeText(productId);
            const index = Number(idx);
            if (!key) return;
            if (!Number.isFinite(index) || index < 0) return;
            evidenceIndexByProductId.set(key, Math.trunc(index));
        });

        if (!invoiceId) throw new CustomError('invoice_id wajib diisi', 400);
        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        const invoice = await Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) throw new CustomError('Invoice tidak ditemukan', 404);

        const shipmentStatus = String(invoice.shipment_status || '').trim().toLowerCase();
        if (['shipped', 'delivered', 'canceled'].includes(shipmentStatus)) {
            throw new CustomError('Invoice sudah lewat gudang dan tidak bisa dicek ulang.', 409);
        }
        if (shipmentStatus === 'checked') {
            throw new CustomError('Invoice ini sudah berstatus checked.', 409);
        }

        const invoiceItems = await InvoiceItem.findAll({
            where: { invoice_id: invoiceId },
            include: [{ model: OrderItem, required: true, attributes: ['product_id', 'order_id'] }],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (invoiceItems.length === 0) throw new CustomError('Invoice item kosong; tidak bisa dilakukan checking.', 409);

        const expectedQtyByProduct = new Map<string, number>();
        const orderIdsFromItems = new Set<string>();
        invoiceItems.forEach((row: any) => {
            const productId = String(row?.OrderItem?.product_id || '').trim();
            const orderId = String(row?.OrderItem?.order_id || '').trim();
            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            if (orderId) orderIdsFromItems.add(orderId);
            if (!productId || qty <= 0) return;
            expectedQtyByProduct.set(productId, Number(expectedQtyByProduct.get(productId) || 0) + qty);
        });
        if (expectedQtyByProduct.size === 0) {
            throw new CustomError('Invoice item tidak memiliki product yang valid untuk checking.', 409);
        }

        const rawItems = parseItemsFromBody(req.body?.items);
        const byProductInput = new Map<string, { qty_checked: number; condition: 'ok' | 'damaged' | 'missing'; note: string | null }>();
        rawItems.forEach((raw) => {
            const productId = normalizeText((raw as any)?.product_id);
            if (!productId) return;
            const qtyChecked = toIntNonNegative((raw as any)?.qty_checked);
            const conditionRaw = normalizeText((raw as any)?.condition).toLowerCase();
            const condition = conditionRaw === 'damaged' ? 'damaged' : conditionRaw === 'missing' ? 'missing' : 'ok';
            const itemNote = normalizeText((raw as any)?.note) || null;
            byProductInput.set(productId, {
                qty_checked: qtyChecked === null ? 0 : qtyChecked,
                condition,
                note: itemNote,
            });
        });

        // Build snapshot rows for all expected products (server-side defaults)
        const snapshotRows: Array<{
            product_id: string;
            qty_expected: number;
            qty_checked: number;
            condition: 'ok' | 'damaged' | 'missing';
            note: string | null;
        }> = [];
        let hasMismatch = false;
        expectedQtyByProduct.forEach((qtyExpected, productId) => {
            const input = byProductInput.get(productId);
            const qtyChecked = input ? input.qty_checked : qtyExpected;
            const condition = input ? input.condition : 'ok';
            const itemNote = input ? input.note : null;
            if (qtyChecked !== qtyExpected || condition !== 'ok') hasMismatch = true;
            snapshotRows.push({
                product_id: productId,
                qty_expected: qtyExpected,
                qty_checked: qtyChecked,
                condition,
                note: itemNote,
            });
        });

        const shouldFail = checkResult === 'fail' || hasMismatch;
        const courierId = normalizeNullableUuid(invoice.courier_id);
        if (!courierId) throw new CustomError('Invoice belum ditugaskan ke driver.', 409);
        const handover = await DeliveryHandover.create({
            invoice_id: invoiceId,
            courier_id: courierId,
            checker_id: String(req.user?.id || ''),
            status: shouldFail ? 'checked_failed' : 'checked_passed',
            checked_at: new Date(),
            handed_over_at: null,
            note,
            evidence_url: headerEvidence ? headerEvidence.path : null,
        }, { transaction: t });

        await DeliveryHandoverItem.bulkCreate(
            snapshotRows.map((row) => ({
                handover_id: handover.id,
                product_id: row.product_id,
                qty_expected: row.qty_expected,
                qty_checked: row.qty_checked,
                condition: row.condition,
                note: row.note,
                evidence_url: (() => {
                    const evidenceIndex = evidenceIndexByProductId.get(row.product_id);
                    if (evidenceIndex === undefined) return null;
                    const f = itemEvidenceFiles[evidenceIndex];
                    return f?.path ? String(f.path) : null;
                })(),
            })),
            { transaction: t }
        );

        const relatedOrderIds = await findOrderIdsByInvoiceId(invoiceId, { transaction: t });
        const orderIds = relatedOrderIds.length > 0 ? relatedOrderIds : Array.from(orderIdsFromItems);
        if (orderIds.length === 0) throw new CustomError('Order terkait invoice tidak ditemukan.', 409);

        const orders = await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        }) as any[];

        if (orders.length === 0) throw new CustomError('Order terkait invoice tidak ditemukan.', 409);

        const nextOrderStatus = shouldFail ? 'hold' : 'checked';

        for (const order of orders) {
            const prevStatus = String(order.status || '');
            const prevStatusKey = prevStatus.trim().toLowerCase();

            // Some flows can leave the overall order already in the delivery lane (e.g. previously handed over),
            // while a new invoice/checking is being processed. In that case, do not move the order backwards
            // to 'checked'; keep it as-is and only record the warehouse checking event.
            const shouldSkipPassStatusUpdate = !shouldFail && ['shipped', 'delivered', 'partially_fulfilled', 'completed'].includes(prevStatusKey);

            if (!shouldSkipPassStatusUpdate) {
                if (!isOrderTransitionAllowed(prevStatus, nextOrderStatus)) {
                    throw new CustomError(`Transisi status tidak diizinkan: '${prevStatus}' -> '${nextOrderStatus}'`, 409);
                }

                await order.update({ status: nextOrderStatus }, { transaction: t });
                await recordOrderStatusChanged({
                    transaction: t,
                    order_id: String(order.id),
                    invoice_id: invoiceId,
                    from_status: prevStatus,
                    to_status: nextOrderStatus,
                    actor_user_id: actorId,
                    actor_role: actorRole,
                    reason: 'delivery_handover_check',
                });

                await emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextOrderStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: courierId || String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: shouldFail ? ['admin_gudang', 'super_admin', 'kasir'] : ['admin_gudang', 'super_admin', 'driver'],
                    target_user_ids: courierId ? [courierId] : []
                }, {
                    transaction: t,
                    requestContext: `delivery_handover_check_status_changed:${invoiceId}:${order.id}`
                });
            }

            await recordOrderEvent({
                transaction: t,
                order_id: String(order.id),
                invoice_id: invoiceId,
                event_type: 'warehouse_checked',
                payload: {
                    handover_id: handover.id,
                    result: shouldFail ? 'fail' : 'pass',
                    has_mismatch: hasMismatch,
                    skipped_status_update: shouldSkipPassStatusUpdate,
                },
                actor_user_id: actorId,
                actor_role: actorRole,
            });
        }

        if (shouldFail) {
            const dueAt = new Date(Date.now() + ISSUE_SLA_MS);
            for (const order of orders) {
                const existing = await OrderIssue.findOne({
                    where: { order_id: String(order.id), status: 'open', issue_type: 'shortage' },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
                const mergedNote = [note, hasMismatch ? 'Checker: ditemukan selisih/mismatch saat checking.' : null]
                    .filter(Boolean)
                    .join('\n')
                    .trim() || null;
                const evidenceUrl = headerEvidence ? headerEvidence.path : null;
                if (existing) {
                    await existing.update({
                        note: mergedNote || existing.note,
                        evidence_url: evidenceUrl || existing.evidence_url,
                        due_at: existing.due_at || dueAt,
                        created_by: existing.created_by || actorId,
                    }, { transaction: t });
                } else {
                    await OrderIssue.create({
                        order_id: String(order.id),
                        issue_type: 'shortage',
                        status: 'open',
                        note: mergedNote,
                        evidence_url: evidenceUrl,
                        resolution_note: null,
                        due_at: dueAt,
                        resolved_at: null,
                        created_by: actorId,
                        resolved_by: null,
                    } as any, { transaction: t });
                }
            }
        } else {
            // Preventive: ensure reservations exist before handover/goods-out posting.
            // This avoids handover failures due to missing batch reservations.
            for (const order of orders) {
                try {
                    await InventoryReservationService.syncReservationsForOrder({ order_id: String(order.id), transaction: t });
                } catch (error: any) {
                    if (error instanceof CustomError) throw error;
                    const message = String(error?.message || error || '').trim();
                    throw new CustomError(
                        message ? `Gagal sync reservasi sebelum handover: ${message}` : 'Gagal sync reservasi sebelum handover.',
                        409
                    );
                }
            }

            await OrderAllocation.update(
                { status: 'picked', picked_at: new Date() },
                {
                    where: {
                        order_id: { [Op.in]: orders.map((o: any) => String(o.id)).filter(Boolean) },
                        status: 'pending',
                    },
                    transaction: t,
                }
            );
            await invoice.update({
                shipment_status: 'checked',
            }, { transaction: t });
        }

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: `delivery_handover_check_refresh:${invoiceId}`
        });

        await t.commit();
        res.json({
            message: shouldFail ? 'Checking gagal: order dipindahkan ke HOLD.' : 'Invoice berhasil dicek (checked).',
            invoice_id: invoiceId,
            handover_id: handover.id,
            result: shouldFail ? 'fail' : 'pass',
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const getLatestByInvoice = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = normalizeText(req.query?.invoice_id);
    if (!invoiceId) throw new CustomError('invoice_id wajib diisi', 400);

    const latest = await DeliveryHandover.findOne({
        where: { invoice_id: invoiceId },
        order: [['checked_at', 'DESC'], ['id', 'DESC']],
        attributes: ['id', 'invoice_id', 'courier_id', 'checker_id', 'status', 'checked_at', 'handed_over_at', 'note', 'evidence_url'],
        include: [
            {
                model: DeliveryHandoverItem,
                as: 'Items',
                required: false,
                attributes: ['id', 'product_id', 'qty_expected', 'qty_checked', 'condition', 'note', 'evidence_url'],
                include: [{ model: Product, as: 'Product', required: false, attributes: ['id', 'name', 'sku', 'unit'] }]
            }
        ]
    }) as any;

    if (!latest) return res.json({ handover: null });
    return res.json({ handover: latest });
});

export const handoverToDriver = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = Number(req.params?.id);
        if (!Number.isFinite(id) || id <= 0) throw new CustomError('handover id tidak valid', 400);

        const actorId = String(req.user?.id || '').trim() || null;
        const actorRole = String(req.user?.role || '').trim() || null;

        const handover = await DeliveryHandover.findByPk(id, {
            include: [{ model: DeliveryHandoverItem, as: 'Items' }],
            transaction: t,
            lock: t.LOCK.UPDATE
        }) as any;
        if (!handover) throw new CustomError('Handover tidak ditemukan', 404);

        const status = String(handover.status || '').trim().toLowerCase();
        if (status !== 'checked_passed') throw new CustomError('Handover belum lolos checking atau sudah diproses.', 409);

        const invoiceId = String(handover.invoice_id || '').trim();
        if (!invoiceId) throw new CustomError('invoice_id pada handover tidak valid', 409);

        const invoice = await Invoice.findByPk(invoiceId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) throw new CustomError('Invoice tidak ditemukan', 404);
        const shipmentStatus = String(invoice.shipment_status || '').trim().toLowerCase();
        if (shipmentStatus !== 'checked') throw new CustomError('Invoice belum berstatus checked.', 409);

        const courierId = normalizeNullableUuid(invoice.courier_id);
        if (!courierId) throw new CustomError('Invoice belum ditugaskan ke driver (courier_id tidak valid).', 409);

        const relatedOrderIds = await findOrderIdsByInvoiceId(invoiceId, { transaction: t });
        if (relatedOrderIds.length === 0) throw new CustomError('Order terkait invoice tidak ditemukan.', 409);
        const orders = await Order.findAll({
            where: { id: { [Op.in]: relatedOrderIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        }) as any[];
        if (orders.length === 0) throw new CustomError('Order terkait invoice tidak ditemukan.', 409);

        const activeBackorders = await Backorder.findAll({
            include: [{
                model: OrderItem,
                required: true,
                attributes: ['order_id'],
                where: { order_id: { [Op.in]: relatedOrderIds } }
            }],
            where: {
                qty_pending: { [Op.gt]: 0 },
                status: { [Op.notIn]: ['fulfilled', 'canceled'] }
            },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.SHARE
        }) as any[];
	        const orderIdsWithActiveBackorder = new Set<string>();
	        activeBackorders.forEach((row: any) => {
	            const orderId = String(row?.OrderItem?.order_id || '').trim();
	            if (orderId) orderIdsWithActiveBackorder.add(orderId);
	        });

	        if (orderIdsWithActiveBackorder.size > 0) {
	            throw new CustomError(
	                `Invoice tidak bisa di-handover karena order berikut masih memiliki backorder aktif: ${Array.from(orderIdsWithActiveBackorder).sort().join(', ')}. Untuk kebijakan 1 goods-out per order, sisa backorder harus dipisah menjadi child order terlebih dahulu.`,
	                409
	            );
	        }

	        for (const order of orders) {
	            const prevStatus = String(order.status || '');
	            const prevStatusKey = prevStatus.trim().toLowerCase();
	            const hasActiveBackorder = false;
	            // Handover adalah tahap shipping + goods-out. Order yang masih punya backorder aktif
	            // harus di-split (child order) dulu supaya goods-out tetap 1x per order dan data tidak korup.
	            const nextOrderStatus = 'shipped';
	            if (['delivered', 'completed', 'partially_fulfilled', 'canceled', 'cancelled'].includes(prevStatusKey)) {
	                throw new CustomError(
	                    `Order sudah berstatus '${prevStatus}' sehingga invoice ini tidak bisa di-handover ke driver. (Order sudah selesai dikirim).`,
	                    409
	                );
	            }
	            if (!isOrderTransitionAllowed(prevStatus, nextOrderStatus)) {
	                throw new CustomError(`Transisi status tidak diizinkan: '${prevStatus}' -> '${nextOrderStatus}'`, 409);
	            }
	            await order.update({ status: nextOrderStatus as any, courier_id: courierId }, { transaction: t });
            await recordOrderStatusChanged({
                transaction: t,
                order_id: String(order.id),
                invoice_id: invoiceId,
                from_status: prevStatus,
                to_status: nextOrderStatus,
                actor_user_id: actorId,
                actor_role: actorRole,
                reason: 'delivery_handover_handed_over',
            });

            await emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: prevStatus,
                to_status: nextOrderStatus,
                source: String(order.source || ''),
                payment_method: String(invoice.payment_method || ''),
                courier_id: courierId,
                triggered_by_role: String(req.user?.role || ''),
                target_roles: ['driver', 'customer', 'admin_finance'],
                target_user_ids: [courierId]
            }, {
                transaction: t,
                requestContext: `delivery_handover_handed_over_status_changed:${invoiceId}:${order.id}`
            });

	            await recordOrderEvent({
	                transaction: t,
	                order_id: String(order.id),
	                invoice_id: invoiceId,
	                event_type: 'warehouse_handed_over',
	                payload: { handover_id: handover.id, has_active_backorder: hasActiveBackorder },
	                actor_user_id: actorId,
	                actor_role: actorRole,
	            });
	        }

        for (const order of orders) {
            const method = String(invoice.payment_method || '').toLowerCase() === 'cod' ? 'cod' : 'non_cod';
            try {
                await AccountingPostingService.postGoodsOutForOrder(String(order.id), String(req.user?.id || ''), t, method as any, invoiceId);
            } catch (error: any) {
                if (error instanceof CustomError) throw error;
                const message = String(error?.message || error || '').trim();
                throw new CustomError(
                    message ? `Gagal posting goods out: ${message}` : 'Gagal posting goods out (inventory/jurnal).',
                    409
                );
            }
        }

        await invoice.update({
            shipment_status: 'shipped',
            shipped_at: new Date(),
            courier_id: courierId,
        }, { transaction: t });

        await handover.update({
            status: 'handed_over',
            courier_id: courierId,
            handed_over_at: new Date(),
        }, { transaction: t });

        await emitAdminRefreshBadges({
            transaction: t,
            requestContext: `delivery_handover_handed_over_refresh:${invoiceId}`
        });

        await t.commit();
        res.json({
            message: 'Handover berhasil: invoice menjadi shipped.',
            invoice_id: invoiceId,
            handover_id: handover.id,
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
