import { Request, Response } from 'express';
import { StockOpname, StockOpnameItem, Product, User, sequelize, Account } from '../models';
import { JournalService } from '../services/JournalService';
import { InventoryCostService } from '../services/InventoryCostService';

export const getAllOpnames = async (req: Request, res: Response) => {
    try {
        const opnames = await StockOpname.findAll({
            include: [{ model: User, as: 'Creator', attributes: ['id', 'name'] }],
            order: [['createdAt', 'DESC']]
        });
        res.json(opnames);
    } catch (error) {
        console.error('Error fetching opnames:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOpnameDetail = async (req: Request, res: Response) => {
    try {
        const { id } = req.params as { id: string };
        const opname = await StockOpname.findByPk(id, {
            include: [
                { model: User, as: 'Creator', attributes: ['id', 'name'] },
                {
                    model: StockOpnameItem,
                    as: 'Items',
                    include: [{ model: Product, as: 'Product', attributes: ['id', 'name', 'sku'] }]
                }
            ]
        });

        if (!opname) return res.status(404).json({ message: 'Opname not found' });
        res.json(opname);
    } catch (error) {
        console.error('Error fetching opname detail:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const startOpname = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = (req as any).user?.id;
        const { notes } = req.body;

        const opname = await StockOpname.create({
            admin_id: userId,
            status: 'open',
            notes,
            started_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.status(201).json(opname);
    } catch (error) {
        await t.rollback();
        console.error('Error starting opname:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const submitOpnameItem = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const { product_id, physical_qty } = req.body;

        const opname = await StockOpname.findByPk(id);
        if (!opname || opname.status !== 'open') {
            await t.rollback();
            return res.status(400).json({ message: 'Opname not found or not open' });
        }

        const product = await Product.findByPk(product_id);
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
        }

        const system_qty = product.stock_quantity;
        const difference = physical_qty - system_qty;

        // Check if item already exists in this opname
        const existingItem = await StockOpnameItem.findOne({
            where: { opname_id: id, product_id },
            transaction: t
        });

        if (existingItem) {
            await existingItem.update({
                physical_qty,
                system_qty, // Update system snapshot if needed, or keep original? 
                // Usually system_qty should be snapshot at time of audit. 
                // For simplicity, we update it to current system stock if re-audited.
                difference
            }, { transaction: t });
        } else {
            await StockOpnameItem.create({
                opname_id: id,
                product_id,
                system_qty,
                physical_qty,
                difference
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Item audited successfully' });
    } catch (error) {
        await t.rollback();
        console.error('Error submitting opname item:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const finishOpname = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const opname = await StockOpname.findByPk(id);

        if (!opname || opname.status !== 'open') {
            await t.rollback();
            return res.status(400).json({ message: 'Opname not found or not open' });
        }

        const items = await StockOpnameItem.findAll({
            where: { opname_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });
        const gainAcc = await Account.findOne({ where: { code: '4200' }, transaction: t });
        const lossAcc = await Account.findOne({ where: { code: '5600' }, transaction: t });

        for (const item of items) {
            const diff = Number(item.difference || 0);
            if (!diff) continue;
            const product = await Product.findByPk(item.product_id, { transaction: t, lock: t.LOCK.UPDATE });
            if (!product) continue;

            await product.update({
                stock_quantity: Number(item.physical_qty || 0)
            }, { transaction: t });

            const valuation = await InventoryCostService.recordAdjustment({
                product_id: item.product_id,
                qty_diff: diff,
                reference_type: 'stock_opname',
                reference_id: String(id),
                note: `Stock opname adjustment product ${item.product_id}`,
                transaction: t
            });
            const totalCost = Number(valuation.total_cost || 0);
            if (!inventoryAcc || totalCost <= 0) continue;

            if (diff > 0 && gainAcc) {
                await JournalService.createEntry({
                    description: `Adjustment Stok Plus (Opname #${id})`,
                    reference_type: 'inventory_adjustment',
                    reference_id: String(id),
                    created_by: String(req.user?.id || opname.admin_id),
                    idempotency_key: `opname_plus_${id}_${item.product_id}`,
                    lines: [
                        { account_id: inventoryAcc.id, debit: totalCost, credit: 0 },
                        { account_id: gainAcc.id, debit: 0, credit: totalCost }
                    ]
                }, t);
            } else if (diff < 0 && lossAcc) {
                await JournalService.createEntry({
                    description: `Adjustment Stok Minus (Opname #${id})`,
                    reference_type: 'inventory_adjustment',
                    reference_id: String(id),
                    created_by: String(req.user?.id || opname.admin_id),
                    idempotency_key: `opname_minus_${id}_${item.product_id}`,
                    lines: [
                        { account_id: lossAcc.id, debit: totalCost, credit: 0 },
                        { account_id: inventoryAcc.id, debit: 0, credit: totalCost }
                    ]
                }, t);
            }
        }

        await opname.update({
            status: 'completed',
            completed_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json(opname);
    } catch (error) {
        await t.rollback();
        console.error('Error finishing opname:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
