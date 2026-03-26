import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

const toDate = (raw: unknown): Date | null => {
    const value = String(raw || '').trim();
    if (!value) return null;
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const d = dateOnly ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
};

export const getDailySummary = asyncWrapper(async (req: Request, res: Response) => {
    const date = toDate((req.query as any)?.date) || new Date();
    const start = new Date(date);
    const end = new Date(date);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const summaryRow = await sequelize.query(
        `SELECT 
            COUNT(*) AS total_transactions,
            COALESCE(SUM(total), 0) AS total_revenue
         FROM pos_sales
         WHERE status = 'paid'
           AND paid_at BETWEEN :start AND :end`,
        {
            type: QueryTypes.SELECT,
            replacements: { start, end }
        }
    ) as any[];

    const qtyRow = await sequelize.query(
        `SELECT 
            COALESCE(SUM(i.qty), 0) AS total_qty
         FROM pos_sale_items i
         INNER JOIN pos_sales s ON s.id = i.pos_sale_id
         WHERE s.status = 'paid'
           AND s.paid_at BETWEEN :start AND :end`,
        {
            type: QueryTypes.SELECT,
            replacements: { start, end }
        }
    ) as any[];

    const topItems = await sequelize.query(
        `SELECT 
            i.product_id,
            i.sku_snapshot AS sku,
            i.name_snapshot AS product_name,
            i.unit_snapshot AS unit,
            SUM(i.qty) AS qty_sold,
            SUM(i.line_total) AS revenue,
            SUM(i.cogs_total) AS cogs
         FROM pos_sale_items i
         INNER JOIN pos_sales s ON s.id = i.pos_sale_id
         WHERE s.status = 'paid'
           AND s.paid_at BETWEEN :start AND :end
         GROUP BY i.product_id, i.sku_snapshot, i.name_snapshot, i.unit_snapshot
         ORDER BY qty_sold DESC
         LIMIT 20`,
        {
            type: QueryTypes.SELECT,
            replacements: { start, end }
        }
    );

    const summary = (summaryRow?.[0] || {}) as any;
    const qty = (qtyRow?.[0] || {}) as any;
    if (!summary) throw new CustomError('Gagal mengambil summary POS', 500);

    res.json({
        date: start.toISOString().slice(0, 10),
        period: { start: start.toISOString(), end: end.toISOString() },
        summary: {
            total_transactions: Number(summary.total_transactions || 0),
            total_revenue: Number(summary.total_revenue || 0),
            total_qty: Number(qty.total_qty || 0),
        },
        top_items: Array.isArray(topItems) ? topItems : []
    });
});

