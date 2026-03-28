import { Op, Transaction } from 'sequelize';
import {
    ClearancePromo,
    InventoryBatch,
    InventoryBatchConsumption,
    InventoryBatchReservation,
    InventoryCostLedger,
    OrderAllocation,
    OrderItem,
} from '../models';
import { InventoryCostService } from './InventoryCostService';
import { CustomError } from '../utils/CustomError';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
const toQtyInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));
const safeId = (value: unknown) => String(value || '').trim();

const sortBigintIdAsc = (a: any, b: any) => {
    const aNum = Number(a?.id);
    const bNum = Number(b?.id);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
};

const distributeAllocationByItem = (items: any[], allocatedByProduct: Map<string, number>) => {
    const byProduct = new Map<string, any[]>();
    items.forEach((item: any) => {
        const productId = safeId(item?.product_id);
        if (!productId) return;
        const rows = byProduct.get(productId) || [];
        rows.push(item);
        byProduct.set(productId, rows);
    });

    const result = new Map<string, number>();
    byProduct.forEach((rows, productId) => {
        let remaining = Math.max(0, Number(allocatedByProduct.get(productId) || 0));
        const sortedRows = [...rows].sort(sortBigintIdAsc);
        sortedRows.forEach((row: any) => {
            const rowId = safeId(row?.id);
            if (!rowId) return;
            const orderedQty = toQtyInt(row?.qty);
            const allocatedQty = Math.max(0, Math.min(remaining, orderedQty));
            remaining = Math.max(0, remaining - allocatedQty);
            result.set(rowId, allocatedQty);
        });
    });
    return result;
};

export class InventoryReservationService {
    static async syncReservationsForOrder(params: { order_id: string; transaction: Transaction }) {
        const t = params.transaction;
        const orderId = safeId(params.order_id);
        if (!orderId) throw new CustomError('order_id wajib diisi untuk sync reservasi', 400);

        const orderItems = await OrderItem.findAll({
            where: { order_id: orderId },
            attributes: ['id', 'order_id', 'product_id', 'qty', 'clearance_promo_id', 'preferred_unit_cost'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (orderItems.length === 0) {
            return { order_id: orderId, items: [], products: [] };
        }

        const allocations = await OrderAllocation.findAll({
            where: { order_id: orderId },
            attributes: ['product_id', 'allocated_qty'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const allocatedByProduct = new Map<string, number>();
        allocations.forEach((row: any) => {
            const productId = safeId(row?.product_id);
            if (!productId) return;
            const prev = Number(allocatedByProduct.get(productId) || 0);
            allocatedByProduct.set(productId, prev + toQtyInt(row?.allocated_qty));
        });

        const allocatedByItemId = distributeAllocationByItem(
            orderItems.map((row: any) => row.get({ plain: true })),
            allocatedByProduct
        );

        const productIds = Array.from(
            new Set(orderItems.map((row: any) => safeId(row?.product_id)).filter(Boolean))
        );

        // Ensure legacy batches exist, then lock batch rows for all related products.
        const batchesByProductId = new Map<string, any[]>();
        for (const productId of productIds) {
            await InventoryCostService.ensureBootstrapBatchFromState(productId, t);
            const batches = await InventoryBatch.findAll({
                where: {
                    product_id: productId,
                    qty_on_hand: { [Op.gt]: 0 }
                },
                order: [['createdAt', 'ASC'], ['id', 'ASC']],
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            batchesByProductId.set(productId, batches as any[]);
        }

        const promoIds = Array.from(
            new Set(orderItems.map((row: any) => safeId((row as any).clearance_promo_id)).filter(Boolean))
        );
        const promos = promoIds.length > 0
            ? await ClearancePromo.findAll({
                where: { id: { [Op.in]: promoIds } },
                transaction: t,
                lock: t.LOCK.SHARE
            })
            : [];
        const promoById = new Map<string, any>();
        promos.forEach((p: any) => promoById.set(safeId(p?.id), p));

        // Reset reservations: release all existing rows for this order then rebuild based on current allocations + preferences.
        const existing = await InventoryBatchReservation.findAll({
            where: { order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE,
            order: [['id', 'DESC']]
        });

        for (const res of existing as any[]) {
            const productId = safeId(res?.product_id);
            const batchId = safeId(res?.batch_id);
            const qty = toQtyInt(res?.qty_reserved);
            if (qty > 0 && batchId) {
                const candidates = batchesByProductId.get(productId) || [];
                const inMemory = candidates.find((b: any) => safeId(b?.id) === batchId) || null;
                const batch = inMemory || await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.UPDATE });
                if (batch) {
                    const current = toQtyInt((batch as any).qty_reserved);
                    await (batch as any).update({ qty_reserved: Math.max(0, current - qty) }, { transaction: t });
                }
            }
            await res.destroy({ transaction: t });
        }

        const itemsSorted = [...(orderItems as any[])].sort((a: any, b: any) => {
            const aHasPromo = Boolean(safeId(a?.clearance_promo_id));
            const bHasPromo = Boolean(safeId(b?.clearance_promo_id));
            if (aHasPromo !== bHasPromo) return aHasPromo ? -1 : 1;

            const aHasPref = a?.preferred_unit_cost !== null && a?.preferred_unit_cost !== undefined && safeId(a?.preferred_unit_cost) !== '';
            const bHasPref = b?.preferred_unit_cost !== null && b?.preferred_unit_cost !== undefined && safeId(b?.preferred_unit_cost) !== '';
            if (aHasPref !== bHasPref) return aHasPref ? -1 : 1;

            return sortBigintIdAsc(a, b);
        });

        const reservedLayersByItemId = new Map<string, Map<number, number>>();
        const reservedLayersByProductId = new Map<string, Map<number, number>>();

        const trackReserved = (orderItemId: string, productId: string, unitCost: number, qty: number) => {
            const unitCostKey = round4(unitCost);
            const itemMap = reservedLayersByItemId.get(orderItemId) || new Map<number, number>();
            itemMap.set(unitCostKey, (itemMap.get(unitCostKey) || 0) + qty);
            reservedLayersByItemId.set(orderItemId, itemMap);

            const productMap = reservedLayersByProductId.get(productId) || new Map<number, number>();
            productMap.set(unitCostKey, (productMap.get(unitCostKey) || 0) + qty);
            reservedLayersByProductId.set(productId, productMap);
        };

        for (const item of itemsSorted) {
            const orderItemId = safeId(item?.id);
            const productId = safeId(item?.product_id);
            if (!orderItemId || !productId) continue;

            const desired = toQtyInt(allocatedByItemId.get(orderItemId) || 0);
            if (desired <= 0) continue;

            const clearancePromoId = safeId(item?.clearance_promo_id);
            let preferredCost: number | null = null;
            if (clearancePromoId) {
                const promo = promoById.get(clearancePromoId);
                const promoProductId = promo ? safeId((promo as any).product_id) : '';
                if (promo && promoProductId === productId) {
                    preferredCost = round4((promo as any).target_unit_cost);
                }
            } else {
                const rawPreferred = (item as any).preferred_unit_cost;
                if (rawPreferred !== null && rawPreferred !== undefined && safeId(rawPreferred) !== '') {
                    const parsed = Number(rawPreferred);
                    if (Number.isFinite(parsed)) preferredCost = round4(parsed);
                }
            }

            const batches = batchesByProductId.get(productId) || [];
            let remaining = desired;

            const reserveFromBatch = async (batch: any, take: number) => {
                if (take <= 0) return;
                const currentReserved = toQtyInt(batch.qty_reserved);
                await batch.update({ qty_reserved: currentReserved + take }, { transaction: t });
                await InventoryBatchReservation.create({
                    order_id: orderId,
                    order_item_id: orderItemId,
                    product_id: productId,
                    batch_id: safeId(batch.id),
                    qty_reserved: take,
                }, { transaction: t });
                trackReserved(orderItemId, productId, Number(batch.unit_cost || 0), take);
            };

            if (preferredCost !== null && Number.isFinite(preferredCost)) {
                for (const batch of batches as any[]) {
                    if (remaining <= 0) break;
                    const unitCost = round4(batch?.unit_cost);
                    if (unitCost !== round4(preferredCost)) continue;
                    const onHand = toQtyInt(batch?.qty_on_hand);
                    const reserved = toQtyInt(batch?.qty_reserved);
                    const available = Math.max(0, onHand - reserved);
                    const take = Math.min(available, remaining);
                    if (take <= 0) continue;
                    await reserveFromBatch(batch, take);
                    remaining = Math.max(0, remaining - take);
                }
            }

            if (remaining > 0) {
                for (const batch of batches as any[]) {
                    if (remaining <= 0) break;
                    const onHand = toQtyInt(batch?.qty_on_hand);
                    const reserved = toQtyInt(batch?.qty_reserved);
                    const available = Math.max(0, onHand - reserved);
                    const take = Math.min(available, remaining);
                    if (take <= 0) continue;
                    await reserveFromBatch(batch, take);
                    remaining = Math.max(0, remaining - take);
                }
            }

            if (remaining > 0) {
                throw new Error(
                    `Insufficient available inventory batches for product ${productId} to reserve ${desired} qty (remaining ${remaining}).`
                );
            }
        }

        const itemsSummary = Array.from(reservedLayersByItemId.entries()).map(([order_item_id, layersMap]) => ({
            order_item_id,
            reserved_layers: Array.from(layersMap.entries())
                .map(([unit_cost, qty_reserved]) => ({ unit_cost, qty_reserved }))
                .sort((a, b) => a.unit_cost - b.unit_cost)
        }));

        const productSummary = Array.from(reservedLayersByProductId.entries()).map(([product_id, layersMap]) => ({
            product_id,
            reserved_layers: Array.from(layersMap.entries())
                .map(([unit_cost, qty_reserved]) => ({ unit_cost, qty_reserved }))
                .sort((a, b) => a.unit_cost - b.unit_cost)
        }));

        return { order_id: orderId, items: itemsSummary, products: productSummary };
    }

    static async releaseReservationsForOrder(params: { order_id: string; transaction: Transaction }) {
        const t = params.transaction;
        const orderId = safeId(params.order_id);
        if (!orderId) return { order_id: '', released_rows: 0, released_qty: 0 };

        const rows = await InventoryBatchReservation.findAll({
            where: { order_id: orderId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        let releasedQty = 0;
        for (const res of rows as any[]) {
            const batchId = safeId(res?.batch_id);
            const qty = toQtyInt(res?.qty_reserved);
            if (batchId && qty > 0) {
                const batch = await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.UPDATE });
                if (batch) {
                    const current = toQtyInt((batch as any).qty_reserved);
                    await (batch as any).update({ qty_reserved: Math.max(0, current - qty) }, { transaction: t });
                }
                releasedQty += qty;
            }
            await res.destroy({ transaction: t });
        }

        return { order_id: orderId, released_rows: rows.length, released_qty: releasedQty };
    }

    static async consumeReservedForOrderItem(params: {
        order_item_id: string;
        qty: number;
        reference_type: string;
        reference_id: string;
        transaction: Transaction;
        note?: string;
    }) {
	        const t = params.transaction;
	        const orderItemId = safeId(params.order_item_id);
	        const qtyOut = toQtyInt(params.qty);
	        if (!orderItemId) throw new CustomError('order_item_id wajib diisi untuk konsumsi reservasi stok', 400);
	        if (qtyOut <= 0) return { qty: 0, unit_cost: 0, total_cost: 0 };

	        const orderItem = await OrderItem.findByPk(orderItemId, {
	            attributes: ['id', 'product_id'],
	            transaction: t,
	            lock: t.LOCK.UPDATE
	        });
	        if (!orderItem) throw new CustomError('Order item tidak ditemukan untuk konsumsi reservasi', 404);

        const productId = safeId((orderItem as any).product_id);
        await InventoryCostService.ensureBootstrapBatchFromState(productId, t);

        const reservations = await InventoryBatchReservation.findAll({
            where: { order_item_id: orderItemId, qty_reserved: { [Op.gt]: 0 } },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

	        if (reservations.length === 0) {
	            throw new CustomError('Tidak ada reservasi batch inventory untuk item order ini. Coba sync reservasi / alokasi ulang.', 409);
	        }

        // Sort by batch FIFO (createdAt, id)
        const batchIds = Array.from(new Set(reservations.map((r: any) => safeId(r?.batch_id)).filter(Boolean)));
        const batches = batchIds.length > 0
            ? await InventoryBatch.findAll({
                where: { id: { [Op.in]: batchIds } },
                transaction: t,
                lock: t.LOCK.UPDATE,
            })
            : [];
        const batchById = new Map<string, any>();
        batches.forEach((b: any) => batchById.set(safeId(b?.id), b));

        const reservationsSorted = [...(reservations as any[])].sort((a: any, b: any) => {
            const ba = batchById.get(safeId(a?.batch_id));
            const bb = batchById.get(safeId(b?.batch_id));
            const aTime = ba?.createdAt ? new Date(ba.createdAt).getTime() : 0;
            const bTime = bb?.createdAt ? new Date(bb.createdAt).getTime() : 0;
            if (aTime !== bTime) return aTime - bTime;
            const aId = Number(ba?.id);
            const bId = Number(bb?.id);
            if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
            return safeId(ba?.id).localeCompare(safeId(bb?.id));
        });

        let remaining = qtyOut;
        let totalCost = 0;

        for (const res of reservationsSorted) {
            if (remaining <= 0) break;
            const batchId = safeId(res?.batch_id);
            const batch = batchById.get(batchId) || await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!batch) continue;

            const resQty = toQtyInt(res?.qty_reserved);
            if (resQty <= 0) continue;

            const onHand = toQtyInt(batch?.qty_on_hand);
            const reserved = toQtyInt(batch?.qty_reserved);
            const take = Math.min(resQty, remaining, onHand, reserved);
            if (take <= 0) continue;

            const unitCost = Number(batch?.unit_cost || 0);
            const cost = round4(take * unitCost);

            await batch.update({
                qty_on_hand: Math.max(0, onHand - take),
                qty_reserved: Math.max(0, reserved - take)
            }, { transaction: t });

            const nextResQty = Math.max(0, resQty - take);
            if (nextResQty <= 0) {
                await res.destroy({ transaction: t });
            } else {
                await res.update({ qty_reserved: nextResQty }, { transaction: t });
            }

            await InventoryBatchConsumption.create({
                batch_id: batchId,
                product_id: productId,
                qty: take,
                unit_cost: round4(unitCost),
                total_cost: cost,
                reference_type: params.reference_type,
                reference_id: params.reference_id,
                order_item_id: orderItemId,
            }, { transaction: t });

            totalCost = round4(totalCost + cost);
            remaining -= take;
        }

	        if (remaining > 0) {
	            throw new CustomError('Qty reservasi batch inventory tidak cukup untuk diproses (insufficient reserved). Coba sync reservasi / alokasi ulang.', 409);
	        }

        const weightedUnitCost = qtyOut > 0 ? (totalCost / qtyOut) : 0;
        await InventoryCostLedger.create({
            product_id: productId,
            movement_type: 'out',
            qty: qtyOut,
            unit_cost: round4(weightedUnitCost),
            total_cost: round4(totalCost),
            reference_type: params.reference_type,
            reference_id: params.reference_id,
            note: params.note || 'Consume reserved inventory'
        }, { transaction: t });

        await InventoryCostService.syncStateFromBatches(productId, t);

        return { qty: qtyOut, unit_cost: weightedUnitCost, total_cost: round4(totalCost) };
    }
}
