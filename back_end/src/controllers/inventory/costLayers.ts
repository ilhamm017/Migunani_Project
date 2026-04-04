import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { AuditLog, InventoryBatch, InventoryBatchConsumption, InventoryBatchReservation, Product, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { InventoryCostService } from '../../services/InventoryCostService';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
const toQtyInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

const resolveClientIp = (req: Request): string | null => {
    const header = String(req.headers['x-forwarded-for'] || '').trim();
    if (header) return header.split(',')[0].trim() || null;
    const socketIp = (req.socket as any)?.remoteAddress;
    return socketIp ? String(socketIp) : null;
};

const createAuditLog = async (params: {
    req: Request;
    action: string;
    status_code: number;
    success: boolean;
    request_payload?: unknown;
    response_payload?: unknown;
    error_message?: string | null;
    transaction?: any;
}) => {
    const { req } = params;
    const actorUserId = req.user?.id ? String(req.user.id) : null;
    const actorRole = req.user?.role ? String(req.user.role) : null;

    await AuditLog.create({
        actor_user_id: actorUserId,
        actor_role: actorRole,
        method: String(req.method || ''),
        path: String(req.originalUrl || req.path || ''),
        action: params.action,
        status_code: params.status_code,
        success: params.success,
        ip_address: resolveClientIp(req),
        user_agent: req.headers['user-agent'] ? String(req.headers['user-agent']) : null,
        request_payload: params.request_payload ?? null,
        response_payload: params.response_payload ?? null,
        error_message: params.error_message ?? null,
    }, { transaction: params.transaction });
};

export const getCostLayersByProduct = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.productId || '').trim();
    if (!productId) throw new CustomError('productId tidak valid', 400);

    const product = await Product.findByPk(productId, { attributes: ['id', 'sku', 'name'] });
    if (!product) throw new CustomError('Produk tidak ditemukan', 404);

    const orderId = String((req.query as any)?.order_id || '').trim();

    const rowsRaw = await InventoryBatch.findAll({
        where: {
            product_id: productId,
            qty_on_hand: { [Op.gt]: 0 }
        },
        attributes: [
            'unit_cost',
            [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_on_hand'],
            [sequelize.fn('SUM', sequelize.col('qty_reserved')), 'qty_reserved_total']
        ],
        group: ['unit_cost'],
        order: [['unit_cost', 'ASC']],
        raw: true,
    });

    const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
    const toInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

    const reservedForOrderByUnitCost = new Map<number, number>();
    if (orderId) {
        const orderRows = await sequelize.query(
            `SELECT 
                b.unit_cost AS unit_cost,
                COALESCE(SUM(r.qty_reserved), 0) AS qty_reserved_for_order
             FROM inventory_batch_reservations r
             INNER JOIN inventory_batches b ON b.id = r.batch_id
             WHERE r.order_id = :orderId
               AND r.product_id = :productId
             GROUP BY b.unit_cost`,
            {
                type: QueryTypes.SELECT,
                replacements: { orderId, productId }
            }
        ) as any[];

        (Array.isArray(orderRows) ? orderRows : []).forEach((row: any) => {
            reservedForOrderByUnitCost.set(round4(row?.unit_cost), toInt(row?.qty_reserved_for_order));
        });
    }

    const rows = (rowsRaw as any[]).map((row: any) => {
        const unitCost = round4(row?.unit_cost);
        const qtyOnHand = toInt(row?.qty_on_hand);
        const qtyReservedTotal = toInt(row?.qty_reserved_total);
        const qtyAvailable = Math.max(0, qtyOnHand - qtyReservedTotal);
        const qtyReservedForOrder = orderId ? (reservedForOrderByUnitCost.get(unitCost) || 0) : 0;
        const qtyAvailableForOrder = orderId
            ? Math.max(0, qtyOnHand - Math.max(0, qtyReservedTotal - qtyReservedForOrder))
            : qtyAvailable;

        return {
            unit_cost: unitCost,
            qty_on_hand: qtyOnHand,
            qty_reserved_total: qtyReservedTotal,
            qty_available: qtyAvailable,
            ...(orderId ? {
                qty_reserved_for_order: qtyReservedForOrder,
                qty_available_for_order: qtyAvailableForOrder,
            } : {})
        };
    });

    const includeBatches = String((req.query as any)?.include_batches || '').trim() === 'true';
    const batches = includeBatches
        ? await InventoryBatch.findAll({
            where: { product_id: productId },
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
        })
        : [];

    res.json({
        product: { id: productId, sku: (product as any).sku, name: (product as any).name },
        layers: rows,
        ...(includeBatches ? { batches: (batches as any[]).map((b) => b.get({ plain: true })) } : {})
    });
});

export const createCostLayerBatch = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.productId || '').trim();
    if (!productId) throw new CustomError('productId tidak valid', 400);

    const qty = toQtyInt(req.body?.qty);
    const unitCost = Number(req.body?.unit_cost);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : null;
    const mergeSame = req.body?.merge_same_unit_cost === undefined ? true : Boolean(req.body?.merge_same_unit_cost);

    if (qty <= 0) throw new CustomError('qty wajib > 0', 400);
    if (!Number.isFinite(unitCost) || unitCost <= 0) throw new CustomError('unit_cost wajib angka > 0', 400);

    const t = await sequelize.transaction();
    try {
        const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE, attributes: ['id'] });
        if (!product) throw new CustomError('Produk tidak ditemukan', 404);

        const inbound = await InventoryCostService.recordInbound({
            product_id: productId,
            qty,
            unit_cost: unitCost,
            reference_type: 'admin_cost_layer',
            reference_id: `ACL-${Date.now()}`,
            note: note || 'Manual cost layer (admin)',
            merge_same_unit_cost: mergeSame,
            transaction: t,
        });

        // Reconcile products.stock_quantity to available-on-hand derived from batches.
        const agg = await InventoryBatch.findOne({
            where: { product_id: productId },
            attributes: [
                [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum'],
                [sequelize.fn('SUM', sequelize.col('qty_reserved')), 'reserved_sum'],
            ],
            transaction: t,
            raw: true,
        }) as any;
        const qtySum = toQtyInt(agg?.qty_sum);
        const reservedSum = toQtyInt(agg?.reserved_sum);
        const available = Math.max(0, qtySum - reservedSum);
        await (product as any).update({ stock_quantity: available }, { transaction: t });

        const responsePayload = { message: 'Layer HPP dibuat', inbound, stock_quantity: available };
        await createAuditLog({
            req,
            action: 'inventory_cost_layer_create_batch',
            status_code: 200,
            success: true,
            request_payload: { product_id: productId, qty, unit_cost: unitCost, note, merge_same_unit_cost: mergeSame },
            response_payload: responsePayload,
            transaction: t
        });

        await t.commit();
        res.json(responsePayload);
    } catch (error) {
        await t.rollback();
        await createAuditLog({
            req,
            action: 'inventory_cost_layer_create_batch',
            status_code: error instanceof CustomError ? error.statusCode : 500,
            success: false,
            request_payload: req.body ?? null,
            error_message: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
});

export const updateCostLayerBatch = asyncWrapper(async (req: Request, res: Response) => {
    const batchId = String(req.params.batchId || '').trim();
    if (!batchId) throw new CustomError('batchId tidak valid', 400);

    const unitCostRaw = req.body?.unit_cost;
    const qtyOnHandRaw = req.body?.qty_on_hand;
    const noteRaw = req.body?.note;

    const hasUnitCost = unitCostRaw !== undefined;
    const hasQty = qtyOnHandRaw !== undefined;
    const hasNote = noteRaw !== undefined;
    if (!hasUnitCost && !hasQty && !hasNote) throw new CustomError('Tidak ada field untuk diubah', 400);

    const nextUnitCost = hasUnitCost ? Number(unitCostRaw) : 0;
    if (hasUnitCost && (!Number.isFinite(nextUnitCost) || nextUnitCost <= 0)) {
        throw new CustomError('unit_cost wajib angka > 0', 400);
    }
    const nextQty = hasQty ? Number(qtyOnHandRaw) : 0;
    if (hasQty && (!Number.isFinite(nextQty) || Math.trunc(nextQty) < 0)) {
        throw new CustomError('qty_on_hand wajib angka >= 0', 400);
    }
    const nextNote = hasNote ? (typeof noteRaw === 'string' ? noteRaw.trim() : '') : null;

    const t = await sequelize.transaction();
    try {
        const batch = await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!batch) throw new CustomError('Batch tidak ditemukan', 404);

        const reserved = toQtyInt((batch as any).qty_reserved);
        if (reserved > 0) throw new CustomError('Batch tidak bisa diubah karena sudah ada reservasi', 409);

        const before = (batch as any).get({ plain: true });
        const productId = String((batch as any).product_id || '').trim();
        if (!productId) throw new CustomError('product_id batch tidak valid', 409);

        const updatePayload: any = {};
        if (hasNote) updatePayload.note = nextNote || null;
        if (hasQty) updatePayload.qty_on_hand = toQtyInt(nextQty);

        let mergedIntoBatchId: string | null = null;
        if (hasUnitCost) {
            const roundedNext = round4(nextUnitCost);
            const roundedPrev = round4((batch as any).unit_cost);

            if (roundedNext !== roundedPrev) {
                // If another batch exists with same unit_cost (and same product), merge qty_on_hand.
                const target = await InventoryBatch.findOne({
                    where: {
                        product_id: productId,
                        unit_cost: roundedNext,
                        qty_on_hand: { [Op.gt]: 0 },
                        id: { [Op.ne]: batchId },
                    } as any,
                    order: [['createdAt', 'DESC'], ['id', 'DESC']],
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });

                if (target) {
                    const qtyToMove = hasQty ? toQtyInt(nextQty) : toQtyInt((batch as any).qty_on_hand);
                    const targetQty = toQtyInt((target as any).qty_on_hand);
                    await (target as any).update({ qty_on_hand: targetQty + qtyToMove }, { transaction: t });

                    // Keep this batch for history: set qty_on_hand=0, keep unit_cost unchanged, mark note.
                    const prevNote = String((batch as any).note || '').trim();
                    const marker = `MERGED->${String((target as any).id)} @${new Date().toISOString()}`;
                    const mergedNote = [prevNote, marker].filter(Boolean).join(' | ');
                    await (batch as any).update({ qty_on_hand: 0, note: mergedNote }, { transaction: t });
                    mergedIntoBatchId = String((target as any).id);
                } else {
                    updatePayload.unit_cost = roundedNext;
                }
            }
        }

        if (!mergedIntoBatchId && Object.keys(updatePayload).length > 0) {
            await (batch as any).update(updatePayload, { transaction: t });
        }

        await InventoryCostService.syncStateFromBatches(productId, t);

        const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE, attributes: ['id', 'stock_quantity'] });
        if (product) {
            const agg = await InventoryBatch.findOne({
                where: { product_id: productId },
                attributes: [
                    [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum'],
                    [sequelize.fn('SUM', sequelize.col('qty_reserved')), 'reserved_sum'],
                ],
                transaction: t,
                raw: true,
            }) as any;
            const qtySum = toQtyInt(agg?.qty_sum);
            const reservedSum = toQtyInt(agg?.reserved_sum);
            const available = Math.max(0, qtySum - reservedSum);
            await (product as any).update({ stock_quantity: available }, { transaction: t });
        }

        const afterBatch = await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.SHARE });
        const responsePayload = {
            message: mergedIntoBatchId ? 'Batch digabungkan' : 'Batch diperbarui',
            batch: afterBatch ? (afterBatch as any).get({ plain: true }) : null,
            merged_into_batch_id: mergedIntoBatchId
        };

        await createAuditLog({
            req,
            action: 'inventory_cost_layer_update_batch',
            status_code: 200,
            success: true,
            request_payload: { batch_id: batchId, patch: req.body ?? null, before },
            response_payload: responsePayload,
            transaction: t
        });

        await t.commit();
        res.json(responsePayload);
    } catch (error) {
        await t.rollback();
        await createAuditLog({
            req,
            action: 'inventory_cost_layer_update_batch',
            status_code: error instanceof CustomError ? error.statusCode : 500,
            success: false,
            request_payload: { batch_id: batchId, patch: req.body ?? null },
            error_message: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
});

export const deleteCostLayerBatch = asyncWrapper(async (req: Request, res: Response) => {
    const batchId = String(req.params.batchId || '').trim();
    if (!batchId) throw new CustomError('batchId tidak valid', 400);

    const t = await sequelize.transaction();
    try {
        const batch = await InventoryBatch.findByPk(batchId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!batch) throw new CustomError('Batch tidak ditemukan', 404);

        const reserved = toQtyInt((batch as any).qty_reserved);
        const onHand = toQtyInt((batch as any).qty_on_hand);
        if (reserved > 0) throw new CustomError('Batch tidak bisa dihapus karena sudah ada reservasi', 409);
        if (onHand > 0) throw new CustomError('Batch tidak bisa dihapus karena qty_on_hand masih > 0', 409);

        const productId = String((batch as any).product_id || '').trim();
        const before = (batch as any).get({ plain: true });

        const hasConsumption = await InventoryBatchConsumption.findOne({
            where: { batch_id: batchId },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.SHARE
        });
        const hasReservationHistory = await InventoryBatchReservation.findOne({
            where: { batch_id: batchId },
            attributes: ['id'],
            transaction: t,
            lock: t.LOCK.SHARE
        });

        if (hasConsumption || hasReservationHistory) {
            const prevNote = String((batch as any).note || '').trim();
            const marker = `SOFT-DELETED @${new Date().toISOString()}`;
            await (batch as any).update({ note: [prevNote, marker].filter(Boolean).join(' | ') }, { transaction: t });
        } else {
            await (batch as any).destroy({ transaction: t });
        }

        if (productId) {
            await InventoryCostService.syncStateFromBatches(productId, t);
            const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE, attributes: ['id'] });
            if (product) {
                const agg = await InventoryBatch.findOne({
                    where: { product_id: productId },
                    attributes: [
                        [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum'],
                        [sequelize.fn('SUM', sequelize.col('qty_reserved')), 'reserved_sum'],
                    ],
                    transaction: t,
                    raw: true,
                }) as any;
                const qtySum = toQtyInt(agg?.qty_sum);
                const reservedSum = toQtyInt(agg?.reserved_sum);
                const available = Math.max(0, qtySum - reservedSum);
                await (product as any).update({ stock_quantity: available }, { transaction: t });
            }
        }

        const responsePayload = { message: 'Batch dihapus', batch_id: batchId };
        await createAuditLog({
            req,
            action: 'inventory_cost_layer_delete_batch',
            status_code: 200,
            success: true,
            request_payload: { batch_id: batchId, before },
            response_payload: responsePayload,
            transaction: t
        });
        await t.commit();
        res.json(responsePayload);
    } catch (error) {
        await t.rollback();
        await createAuditLog({
            req,
            action: 'inventory_cost_layer_delete_batch',
            status_code: error instanceof CustomError ? error.statusCode : 500,
            success: false,
            request_payload: { batch_id: batchId },
            error_message: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
});
