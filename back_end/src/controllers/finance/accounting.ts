import { Request, Response } from 'express';
import { sequelize, AccountingPeriod } from '../../models';
import { JournalService } from '../../services/JournalService';

// --- Accounting Periods & Adjustments ---

export const getAccountingPeriods = async (req: Request, res: Response) => {
    try {
        const periods = await AccountingPeriod.findAll({
            order: [['year', 'DESC'], ['month', 'DESC']]
        });
        res.json(periods);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching periods', error });
    }
};

export const closeAccountingPeriod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { month, year } = req.body;
        const userId = req.user!.id;

        if (!month || !year) {
            await t.rollback();
            return res.status(400).json({ message: 'Month dan Year wajib diisi' });
        }

        const [period, created] = await AccountingPeriod.findOrCreate({
            where: { month, year },
            defaults: {
                month,
                year,
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            },
            transaction: t
        });

        if (!created && period.is_closed) {
            await t.rollback();
            return res.status(400).json({ message: 'Periode sudah ditutup sebelumnya' });
        }

        if (!created) {
            await period.update({
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: `Periode ${month}/${year} berhasil ditutup`, period });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error closing period', error });
    }
};

export const createAdjustmentJournal = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { date, description, lines } = req.body;
        const userId = req.user!.id;

        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            await t.rollback();
            return res.status(400).json({ message: 'Journal adjustment minimal 2 baris (Debit/Credit)' });
        }

        const journal = await JournalService.createAdjustmentEntry({
            date: date ? new Date(date) : new Date(),
            description: `[ADJUSTMENT] ${description}`,
            reference_type: 'adjustment',
            created_by: userId,
            lines
        }, t);

        await t.commit();
        res.status(201).json({ message: 'Adjustment journal created', journal });
    } catch (error) {
        try { await t.rollback(); } catch { }
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error creating adjustment', error: msg });
    }
};
