import { Op, Transaction } from 'sequelize';
import {
    Product,
    ProductCostState,
    InventoryCostLedger,
    InventoryBatch,
    InventoryBatchConsumption,
    Backorder,
    OrderItem,
    OrderAllocation,
    Order,
    sequelize
} from '../models';
import { findInvoicesByOrderId } from '../utils/invoiceLookup';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
const toQtyInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

export class InventoryCostService {
    static BACKORDER_FILL_GRACE_MS = 24 * 60 * 60 * 1000;

    static isInvoiceShipmentPassedWarehouse(shipmentStatusRaw: unknown): boolean {
        const shipmentStatus = String(shipmentStatusRaw || '').trim().toLowerCase();
        return shipmentStatus === 'shipped' || shipmentStatus === 'delivered' || shipmentStatus === 'canceled';
    }

    static async shouldSkipBackorderAllocationForOrder(orderRaw: any, t: Transaction): Promise<boolean> {
        const order = orderRaw || {};
        const status = String(order.status || '').trim().toLowerCase();

        // Only allocate for orders that are still in allocation/editable states.
        const allowedStatuses = new Set(['pending', 'waiting_invoice', 'allocated', 'hold', 'partially_fulfilled']);
        if (!allowedStatuses.has(status)) return true;

        // Block auto-allocation if THIS order already has an unshipped invoice older than the grace window.
        const orderId = String(order.id || '').trim();
        if (!orderId) return false;
        const invoices = await findInvoicesByOrderId(orderId, { transaction: t });
        const nowMs = Date.now();
        const unshipped = (Array.isArray(invoices) ? invoices : []).filter((inv: any) => inv && !this.isInvoiceShipmentPassedWarehouse(inv?.shipment_status));
        const createdAtMsList = unshipped
            .map((inv: any) => inv?.createdAt ? new Date(inv.createdAt).getTime() : 0)
            .filter((ms: any) => Number(ms) > 0)
            .sort((a: number, b: number) => a - b);
        const oldestMs = createdAtMsList[0] || 0;
        const blockingInvoice = oldestMs > 0 && (nowMs - oldestMs) > this.BACKORDER_FILL_GRACE_MS
            ? unshipped.find((inv: any) => {
                const createdAtMs = inv?.createdAt ? new Date(inv.createdAt).getTime() : 0;
                return createdAtMs === oldestMs;
            })
            : null;
        return Boolean(blockingInvoice);
    }

    static async ensureState(productId: string, t?: Transaction) {
        const [state] = await ProductCostState.findOrCreate({
            where: { product_id: productId },
            defaults: { product_id: productId, on_hand_qty: 0, avg_cost: 0 },
            transaction: t
        });
        return state;
    }

    static async ensureBootstrapBatchFromState(productId: string, t?: Transaction) {
        const state = await this.ensureState(productId, t);
        const qty = toQtyInt(state.on_hand_qty);
        if (qty <= 0) return;

        const existing = await InventoryBatch.findOne({
            where: { product_id: productId },
            attributes: ['id'],
            transaction: t,
            ...(t ? { lock: t.LOCK.SHARE } : {})
        });
        if (existing) return;

        await InventoryBatch.create({
            product_id: productId,
            unit_cost: round4(state.avg_cost),
            qty_on_hand: qty,
            source_type: 'legacy_bootstrap',
            source_id: null,
            note: 'Auto bootstrap from product_cost_states (moving average)'
        }, { transaction: t });
    }

    static async syncStateFromBatches(productId: string, t?: Transaction) {
        const state = await this.ensureState(productId, t);

        const agg = await InventoryBatch.findOne({
            where: { product_id: productId, qty_on_hand: { [Op.gt]: 0 } },
            attributes: [
                [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum'],
                [sequelize.fn('SUM', sequelize.literal('qty_on_hand * unit_cost')), 'value_sum']
            ],
            transaction: t,
            raw: true,
        }) as any;

        const qtySum = toQtyInt(agg?.qty_sum);
        const valueSum = Number(agg?.value_sum || 0);
        const avgCost = qtySum > 0 ? (valueSum / qtySum) : 0;

        await state.update({
            on_hand_qty: qtySum,
            avg_cost: round4(avgCost)
        }, { transaction: t });

        return { on_hand_qty: qtySum, avg_cost: avgCost };
    }

    static async recordInbound(params: {
        product_id: string;
        qty: number;
        unit_cost: number;
        reference_type?: string;
        reference_id?: string;
        note?: string;
        merge_same_unit_cost?: boolean;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const qtyIn = toQtyInt(params.qty);
        const unitCostIn = Math.max(0, Number(params.unit_cost || 0));
        if (qtyIn <= 0) return null;

        const roundedUnitCost = round4(unitCostIn);
        const sourceType = params.reference_type || null;

        if (params.merge_same_unit_cost) {
            const existing = await InventoryBatch.findOne({
                where: {
                    product_id: params.product_id,
                    unit_cost: roundedUnitCost,
                    qty_on_hand: { [Op.gt]: 0 },
                    ...(sourceType ? { source_type: sourceType } : {})
                } as any,
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
                transaction: t,
                ...(t ? { lock: t.LOCK.UPDATE } : {})
            });

            if (existing) {
                await existing.update({
                    qty_on_hand: toQtyInt(Number((existing as any).qty_on_hand || 0) + qtyIn),
                }, { transaction: t });
            } else {
                await InventoryBatch.create({
                    product_id: params.product_id,
                    unit_cost: roundedUnitCost,
                    qty_on_hand: qtyIn,
                    source_type: sourceType,
                    source_id: params.reference_id || null,
                    note: params.note || null
                }, { transaction: t });
            }
        } else {
            await InventoryBatch.create({
                product_id: params.product_id,
                unit_cost: roundedUnitCost,
                qty_on_hand: qtyIn,
                source_type: sourceType,
                source_id: params.reference_id || null,
                note: params.note || null
            }, { transaction: t });
        }

        const totalCost = round4(qtyIn * unitCostIn);
        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: 'in',
            qty: qtyIn,
            unit_cost: roundedUnitCost,
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        const nextState = await this.syncStateFromBatches(params.product_id, t);
        return { qty: qtyIn, unit_cost: unitCostIn, total_cost: totalCost, avg_cost_after: nextState.avg_cost };
    }

    static async consumeFromBatches(params: {
        product_id: string;
        qty: number;
        reference_type: string;
        reference_id: string;
        order_item_id?: string | null;
        transaction?: Transaction;
        note?: string;
        batchWhere?: Record<string, unknown>;
    }) {
        const t = params.transaction;
        const qtyOut = toQtyInt(params.qty);
        if (qtyOut <= 0) return { consumed_qty: 0, total_cost: 0 };

        const batches = await InventoryBatch.findAll({
            where: {
                product_id: params.product_id,
                qty_on_hand: { [Op.gt]: 0 },
                ...(params.batchWhere || {})
            } as any,
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
            transaction: t,
            ...(t ? { lock: t.LOCK.UPDATE } : {})
        });

        let remaining = qtyOut;
        let totalCost = 0;

        for (const batch of batches as any[]) {
            if (remaining <= 0) break;
            const onHand = toQtyInt(batch.qty_on_hand);
            const reserved = toQtyInt(batch.qty_reserved);
            const available = Math.max(0, onHand - reserved);
            if (available <= 0) continue;

            const take = Math.min(available, remaining);
            if (take <= 0) continue;

            const unitCost = Number(batch.unit_cost || 0);
            const cost = round4(take * unitCost);

            await batch.update({
                qty_on_hand: Math.max(0, onHand - take)
            }, { transaction: t });

            await InventoryBatchConsumption.create({
                batch_id: String(batch.id),
                product_id: params.product_id,
                qty: take,
                unit_cost: round4(unitCost),
                total_cost: cost,
                reference_type: params.reference_type,
                reference_id: params.reference_id,
                order_item_id: params.order_item_id ?? null,
            }, { transaction: t });

            totalCost = round4(totalCost + cost);
            remaining -= take;
        }

        return { consumed_qty: qtyOut - remaining, total_cost: totalCost };
    }

    static async consumeOutbound(params: {
        product_id: string;
        qty: number;
        reference_type?: string;
        reference_id?: string;
        order_item_id?: string | null;
        note?: string;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const qtyOut = toQtyInt(params.qty);
        if (qtyOut <= 0) return { qty: 0, unit_cost: 0, total_cost: 0 };

        const referenceType = String(params.reference_type || '').trim() || 'unknown';
        const referenceId = String(params.reference_id || '').trim() || 'unknown';

        await this.ensureBootstrapBatchFromState(params.product_id, t);

        const consumed = await this.consumeFromBatches({
            product_id: params.product_id,
            qty: qtyOut,
            reference_type: referenceType,
            reference_id: referenceId,
            order_item_id: params.order_item_id ?? null,
            note: params.note,
            transaction: t
        });
        if (consumed.consumed_qty !== qtyOut) {
            throw new Error(`Insufficient inventory batches for product ${params.product_id} (need ${qtyOut}, got ${consumed.consumed_qty}). Run SQL migration bootstrap if needed.`);
        }

        const totalCost = round4(consumed.total_cost);
        const weightedUnitCost = qtyOut > 0 ? (totalCost / qtyOut) : 0;

        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: 'out',
            qty: qtyOut,
            unit_cost: round4(weightedUnitCost),
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        await this.syncStateFromBatches(params.product_id, t);

        return { qty: qtyOut, unit_cost: weightedUnitCost, total_cost: totalCost };
    }

    static async consumeOutboundPreferUnitCost(params: {
        product_id: string;
        qty: number;
        preferred_unit_cost: number;
        reference_type?: string;
        reference_id?: string;
        order_item_id?: string | null;
        note?: string;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const qtyOut = toQtyInt(params.qty);
        if (qtyOut <= 0) return { qty: 0, unit_cost: 0, total_cost: 0 };

        const referenceType = String(params.reference_type || '').trim() || 'unknown';
        const referenceId = String(params.reference_id || '').trim() || 'unknown';

        await this.ensureBootstrapBatchFromState(params.product_id, t);

        const preferredCost = round4(Math.max(0, Number(params.preferred_unit_cost || 0)));

        let remaining = qtyOut;
        let totalCost = 0;

        if (Number.isFinite(preferredCost)) {
            const first = await this.consumeFromBatches({
                product_id: params.product_id,
                qty: remaining,
                reference_type: referenceType,
                reference_id: referenceId,
                order_item_id: params.order_item_id ?? null,
                note: params.note,
                transaction: t,
                batchWhere: { unit_cost: preferredCost }
            });
            remaining = Math.max(0, remaining - first.consumed_qty);
            totalCost = round4(totalCost + first.total_cost);
        }

        if (remaining > 0) {
            const second = await this.consumeFromBatches({
                product_id: params.product_id,
                qty: remaining,
                reference_type: referenceType,
                reference_id: referenceId,
                order_item_id: params.order_item_id ?? null,
                note: params.note,
                transaction: t,
            });
            remaining = Math.max(0, remaining - second.consumed_qty);
            totalCost = round4(totalCost + second.total_cost);
        }

        if (remaining > 0) {
            throw new Error(`Insufficient inventory batches for product ${params.product_id} (need ${qtyOut}, remaining ${remaining}). Run SQL migration bootstrap if needed.`);
        }

        const weightedUnitCost = qtyOut > 0 ? (totalCost / qtyOut) : 0;

        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: 'out',
            qty: qtyOut,
            unit_cost: round4(weightedUnitCost),
            total_cost: round4(totalCost),
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        await this.syncStateFromBatches(params.product_id, t);

        return { qty: qtyOut, unit_cost: weightedUnitCost, total_cost: round4(totalCost) };
    }

    static async recordAdjustment(params: {
        product_id: string;
        qty_diff: number;
        reference_type?: string;
        reference_id?: string;
        note?: string;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const diff = Number(params.qty_diff || 0);
        if (!diff) return { total_cost: 0, unit_cost: 0 };

        const referenceType = String(params.reference_type || '').trim() || 'stock_opname';
        const referenceId = String(params.reference_id || '').trim() || 'unknown';

        await this.ensureBootstrapBatchFromState(params.product_id, t);

        const qty = toQtyInt(Math.abs(diff));
        const nextMovementType = diff > 0 ? 'adjustment_plus' : 'adjustment_minus';

        if (diff > 0) {
            const current = await this.syncStateFromBatches(params.product_id, t);
            const unitCost = round4(current.avg_cost);
            const totalCost = round4(qty * unitCost);

            await InventoryBatch.create({
                product_id: params.product_id,
                unit_cost: unitCost,
                qty_on_hand: qty,
                source_type: referenceType,
                source_id: params.reference_id || null,
                note: params.note || null
            }, { transaction: t });

            await InventoryCostLedger.create({
                product_id: params.product_id,
                movement_type: nextMovementType,
                qty,
                unit_cost: unitCost,
                total_cost: totalCost,
                reference_type: params.reference_type || null,
                reference_id: params.reference_id || null,
                note: params.note || null
            }, { transaction: t });

            await this.syncStateFromBatches(params.product_id, t);
            return { total_cost: totalCost, unit_cost: unitCost };
        }

        const consumed = await this.consumeFromBatches({
            product_id: params.product_id,
            qty,
            reference_type: referenceType,
            reference_id: referenceId,
            transaction: t,
            note: params.note,
        });
        if (consumed.consumed_qty !== qty) {
            throw new Error(`Insufficient inventory batches for product ${params.product_id} (need ${qty}, got ${consumed.consumed_qty}).`);
        }

        const totalCost = round4(consumed.total_cost);
        const weightedUnitCost = qty > 0 ? (totalCost / qty) : 0;

        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: nextMovementType,
            qty,
            unit_cost: round4(weightedUnitCost),
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        await this.syncStateFromBatches(params.product_id, t);
        return { total_cost: totalCost, unit_cost: weightedUnitCost };
    }

    static async autoAllocateBackordersForProduct(productId: string, transaction?: Transaction) {
        const ownsTx = !transaction;
        const t = transaction || await sequelize.transaction();
        try {
            let product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
            if (!product) {
                if (ownsTx) await t.commit();
                return;
            }

            const backorders = await Backorder.findAll({
                where: { status: 'waiting_stock', qty_pending: { [Op.gt]: 0 } },
                include: [{
                    model: OrderItem,
                    where: { product_id: productId },
                    include: [{ model: Order, required: false }]
                }],
                order: [['createdAt', 'ASC']],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            const skipOrderCache = new Map<string, boolean>();

            for (const bo of backorders as any[]) {
                product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
                if (!product) break;
                const available = Number(product.stock_quantity || 0);
                if (available <= 0) break;

                const pending = Number(bo.qty_pending || 0);
                if (pending <= 0) continue;
                const allocateQty = Math.min(available, pending);
                if (allocateQty <= 0) continue;

                const orderItem = bo.OrderItem;
                if (!orderItem) continue;
                const order = orderItem.Order || null;
                const orderId = String(orderItem.order_id);
                if (order) {
                    const cacheKey = String(order.id || orderId || '').trim() || orderId;
                    const cached = skipOrderCache.get(cacheKey);
                    const shouldSkip = typeof cached === 'boolean'
                        ? cached
                        : await this.shouldSkipBackorderAllocationForOrder(order, t);
                    skipOrderCache.set(cacheKey, shouldSkip);
                    if (shouldSkip) continue;
                }

                const [allocation] = await OrderAllocation.findOrCreate({
                    where: { order_id: orderId, product_id: productId },
                    defaults: {
                        order_id: orderId,
                        product_id: productId,
                        allocated_qty: 0,
                        status: 'pending'
                    },
                    transaction: t
                });

                await allocation.update({
                    allocated_qty: Number(allocation.allocated_qty || 0) + allocateQty
                }, { transaction: t });

                await product.update({
                    stock_quantity: Number(product.stock_quantity || 0) - allocateQty,
                    allocated_quantity: Number(product.allocated_quantity || 0) + allocateQty
                }, { transaction: t });

                const remain = pending - allocateQty;
                await bo.update({
                    qty_pending: Math.max(0, remain),
                    status: remain > 0 ? 'waiting_stock' : 'fulfilled'
                }, { transaction: t });
            }

            if (ownsTx) await t.commit();
        } catch (error) {
            if (ownsTx) await t.rollback();
            throw error;
        }
    }
}
