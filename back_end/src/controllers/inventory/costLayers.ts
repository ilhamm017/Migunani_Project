import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { InventoryBatch, Product, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

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
