import { Request, Response } from 'express';
import { sequelize, AccountingPeriod } from '../../models';
import { JournalService } from '../../services/JournalService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

// --- Accounting Periods & Adjustments ---

export const getAccountingPeriods = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const periods = await AccountingPeriod.findAll({
            order: [['year', 'DESC'], ['month', 'DESC']]
        });
        res.json(periods);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching periods', 500);
    }
});

export const closeAccountingPeriod = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { month, year } = req.body;
        const userId = req.user!.id;

        if (!month || !year) {
            await t.rollback();
            throw new CustomError('Month dan Year wajib diisi', 400);
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
            throw new CustomError('Periode sudah ditutup sebelumnya', 400);
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
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error closing period', 500);
    }
});

export const createAdjustmentJournal = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const scope = `finance_adjustment:${String(req.user?.id || '')}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, scope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 201)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan adjustment duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const { date, description, lines } = req.body;
        const userId = req.user!.id;

        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            await t.rollback();
            throw new CustomError('Journal adjustment minimal 2 baris (Debit/Credit)', 400);
        }

        const journal = await JournalService.createAdjustmentEntry({
            date: date ? new Date(date) : new Date(),
            description: `[ADJUSTMENT] ${description}`,
            reference_type: 'adjustment',
            created_by: userId,
            lines,
            idempotency_key: idempotencyKey ? `adjustment_${idempotencyKey}` : undefined
        }, t);

        await t.commit();
        const responsePayload = { message: 'Adjustment journal created', journal };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, scope, 201, responsePayload);
        }
        res.status(201).json(responsePayload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, scope);
        }
        if (error instanceof CustomError) {
            throw error;
        }
        const msg = error instanceof Error ? error.message : 'Unknown error';
        throw new CustomError(`Error creating adjustment: ${msg}`, 500);
    }
});
