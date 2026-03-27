import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { InventoryBatch, Product, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getCostLayersByProduct = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.productId || '').trim();
    if (!productId) throw new CustomError('productId tidak valid', 400);

    const product = await Product.findByPk(productId, { attributes: ['id', 'sku', 'name'] });
    if (!product) throw new CustomError('Produk tidak ditemukan', 404);

    const rowsRaw = await InventoryBatch.findAll({
        where: {
            product_id: productId,
            qty_on_hand: { [Op.gt]: 0 }
        },
        attributes: [
            'unit_cost',
            [sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_on_hand']
        ],
        group: ['unit_cost'],
        order: [['unit_cost', 'ASC']],
        raw: true,
    });

    const rows = (rowsRaw as any[]).map((row: any) => ({
        unit_cost: Number(row?.unit_cost || 0),
        qty_on_hand: Math.max(0, Math.trunc(Number(row?.qty_on_hand || 0))),
    }));

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

