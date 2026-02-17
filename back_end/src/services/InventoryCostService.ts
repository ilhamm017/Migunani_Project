import { Op, Transaction } from 'sequelize';
import {
    Product,
    ProductCostState,
    InventoryCostLedger,
    Backorder,
    OrderItem,
    OrderAllocation,
    Order,
    sequelize
} from '../models';

export class InventoryCostService {
    static async ensureState(productId: string, t?: Transaction) {
        const [state] = await ProductCostState.findOrCreate({
            where: { product_id: productId },
            defaults: { product_id: productId, on_hand_qty: 0, avg_cost: 0 },
            transaction: t
        });
        return state;
    }

    static async recordInbound(params: {
        product_id: string;
        qty: number;
        unit_cost: number;
        reference_type?: string;
        reference_id?: string;
        note?: string;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const qtyIn = Math.max(0, Number(params.qty || 0));
        const unitCostIn = Math.max(0, Number(params.unit_cost || 0));
        if (qtyIn <= 0) return null;

        const state = await this.ensureState(params.product_id, t);
        const qtyOld = Number(state.on_hand_qty || 0);
        const avgOld = Number(state.avg_cost || 0);
        const qtyNew = qtyOld + qtyIn;
        const avgNew = qtyNew > 0
            ? (((qtyOld * avgOld) + (qtyIn * unitCostIn)) / qtyNew)
            : 0;

        await state.update({
            on_hand_qty: qtyNew,
            avg_cost: Number(avgNew.toFixed(4))
        }, { transaction: t });

        const totalCost = Number((qtyIn * unitCostIn).toFixed(4));
        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: 'in',
            qty: qtyIn,
            unit_cost: Number(unitCostIn.toFixed(4)),
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        return { qty: qtyIn, unit_cost: unitCostIn, total_cost: totalCost, avg_cost_after: avgNew };
    }

    static async consumeOutbound(params: {
        product_id: string;
        qty: number;
        reference_type?: string;
        reference_id?: string;
        note?: string;
        transaction?: Transaction;
    }) {
        const t = params.transaction;
        const qtyOut = Math.max(0, Number(params.qty || 0));
        if (qtyOut <= 0) return { qty: 0, unit_cost: 0, total_cost: 0 };

        const state = await this.ensureState(params.product_id, t);
        const qtyOld = Number(state.on_hand_qty || 0);
        const avgCost = Number(state.avg_cost || 0);
        const qtyNew = Math.max(0, qtyOld - qtyOut);

        await state.update({ on_hand_qty: qtyNew }, { transaction: t });

        const totalCost = Number((qtyOut * avgCost).toFixed(4));
        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: 'out',
            qty: qtyOut,
            unit_cost: Number(avgCost.toFixed(4)),
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });

        return { qty: qtyOut, unit_cost: avgCost, total_cost: totalCost };
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
        const state = await this.ensureState(params.product_id, t);
        const avgCost = Number(state.avg_cost || 0);
        const qtyOld = Number(state.on_hand_qty || 0);
        const qtyNew = Math.max(0, qtyOld + diff);

        await state.update({ on_hand_qty: qtyNew }, { transaction: t });

        const movementType = diff > 0 ? 'adjustment_plus' : 'adjustment_minus';
        const qty = Math.abs(diff);
        const totalCost = Number((qty * avgCost).toFixed(4));
        await InventoryCostLedger.create({
            product_id: params.product_id,
            movement_type: movementType,
            qty,
            unit_cost: Number(avgCost.toFixed(4)),
            total_cost: totalCost,
            reference_type: params.reference_type || null,
            reference_id: params.reference_id || null,
            note: params.note || null
        }, { transaction: t });
        return { total_cost: totalCost, unit_cost: avgCost };
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
                const orderId = String(orderItem.order_id);

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
