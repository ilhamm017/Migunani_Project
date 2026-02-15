import { Request, Response } from 'express';
import { StockOpname, StockOpnameItem, Product, User, sequelize } from '../models';

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

        await opname.update({
            status: 'completed',
            completed_at: new Date()
        }, { transaction: t });

        // Note: Real audit usually adjusts stock automatically or creates mutation.
        // For now, we just record the audit report as per requirement "mencatat selisih dan menampilkan dalam bentuk laporan audit".
        // If automatic adjustment is needed, we would create StockMutation here.
        // I'll assume reporting only for now, unless specified "adjust stock".
        // Re-reading request: "Sistem akan mencatat selisih dan menampilkan dalam bentuk laporan audit jika sudah selesai."
        // Doesn't explicitly say "auto-adjust inventory". 

        await t.commit();
        res.json(opname);
    } catch (error) {
        await t.rollback();
        console.error('Error finishing opname:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
