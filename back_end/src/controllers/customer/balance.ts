import { Request, Response } from 'express';
import { Account, sequelize } from '../../models';
import { CustomerBalanceService } from '../../services/CustomerBalanceService';
import { JournalService } from '../../services/JournalService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const round2 = (value: number) => Math.round((toNumber(value) || 0) * 100) / 100;

const resolveIdempotencyKey = (req: Request): string => {
    const fromHeader = getIdempotencyKey(req);
    if (fromHeader) return fromHeader;
    return String((req.body as any)?.idempotency_key || '').trim();
};

export const getCustomerBalance = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) throw new CustomError('ID customer tidak valid', 400);

    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50) || 50));
    const offset = Math.max(0, Number(req.query?.offset || 0) || 0);

    const summary = await CustomerBalanceService.getSummary(customerId);
    const list = await CustomerBalanceService.listEntries(customerId, { limit, offset });
    const lastEntryAt = list.entries.length > 0 ? (list.entries[0] as any).createdAt : null;

    res.json({
        as_of: new Date().toISOString(),
        ...summary,
        last_entry_at: lastEntryAt ? new Date(lastEntryAt).toISOString() : null,
        entries: list.entries,
        paging: {
            total: list.total,
            limit: list.limit,
            offset: list.offset,
        }
    });
});

export const manualPayment = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) throw new CustomError('ID customer tidak valid', 400);

    const actorId = String(req.user?.id || '').trim();
    if (!actorId) throw new CustomError('Unauthorized', 401);

    const idempotencyKey = resolveIdempotencyKey(req);
    const idempotencyScope = `customer_balance_manual_payment:${actorId}:${customerId}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan manual payment duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const amount = round2(toNumber((req.body as any)?.amount));
        const paymentAccountCode = String((req.body as any)?.payment_account_code || '1101').trim() || '1101';
        const note = typeof (req.body as any)?.note === 'string' ? String((req.body as any).note).trim() : '';

        if (!Number.isFinite(amount) || amount <= 0) {
            await t.rollback();
            throw new CustomError('amount tidak valid', 400);
        }

        const balanceBefore = await CustomerBalanceService.getBalance(customerId, { transaction: t });

        await CustomerBalanceService.createEntry({
            customer_id: customerId,
            amount,
            entry_type: 'manual_payment',
            reference_type: 'manual_payment',
            reference_id: null,
            created_by: actorId,
            note: note || 'Pembayaran tambahan manual',
            idempotency_key: idempotencyKey ? `balance_manual_payment_${idempotencyKey}` : null,
        }, { transaction: t });

        const paymentAcc = await Account.findOne({ where: { code: paymentAccountCode }, transaction: t });
        const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
        const customerSaldoAcc = await Account.findOne({ where: { code: '2105' }, transaction: t });
        if (!paymentAcc) {
            await t.rollback();
            throw new CustomError('Akun pembayaran tidak ditemukan', 409);
        }

        const lines: any[] = [];
        lines.push({ account_id: paymentAcc.id, debit: amount, credit: 0 });

        const debtToClose = balanceBefore < 0 ? Math.min(amount, Math.abs(balanceBefore)) : 0;
        const remaining = round2(amount - debtToClose);

        if (debtToClose > 0) {
            if (!arAcc) {
                await t.rollback();
                throw new CustomError('Akun piutang usaha (1103) tidak ditemukan', 409);
            }
            lines.push({ account_id: arAcc.id, debit: 0, credit: debtToClose });
        }
        if (remaining > 0) {
            if (!customerSaldoAcc) {
                await t.rollback();
                throw new CustomError('Akun saldo customer (2105) tidak ditemukan', 409);
            }
            lines.push({ account_id: customerSaldoAcc.id, debit: 0, credit: remaining });
        }

        if (lines.length >= 2) {
            await JournalService.createEntry({
                description: `Manual payment saldo customer (${customerId})`,
                reference_type: 'customer_balance_manual_payment',
                reference_id: customerId,
                created_by: actorId,
                idempotency_key: idempotencyKey ? `journal_manual_payment_${idempotencyKey}` : undefined,
                lines
            }, t);
        }

        const balanceAfter = await CustomerBalanceService.getBalance(customerId, { transaction: t });
        await t.commit();

        const payload = {
            message: 'Manual payment berhasil dicatat',
            customer_id: customerId,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, payload);
        }
        return res.json(payload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal mencatat manual payment', 500);
    }
});

export const manualRefund = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) throw new CustomError('ID customer tidak valid', 400);

    const actorId = String(req.user?.id || '').trim();
    if (!actorId) throw new CustomError('Unauthorized', 401);

    const idempotencyKey = resolveIdempotencyKey(req);
    const idempotencyScope = `customer_balance_manual_refund:${actorId}:${customerId}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan manual refund duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const amount = round2(toNumber((req.body as any)?.amount));
        const paymentAccountCode = String((req.body as any)?.payment_account_code || '1101').trim() || '1101';
        const note = typeof (req.body as any)?.note === 'string' ? String((req.body as any).note).trim() : '';

        if (!Number.isFinite(amount) || amount <= 0) {
            await t.rollback();
            throw new CustomError('amount tidak valid', 400);
        }

        const balanceBefore = await CustomerBalanceService.getBalance(customerId, { transaction: t });
        if (balanceBefore < amount) {
            await t.rollback();
            throw new CustomError('Saldo customer tidak cukup untuk refund', 409);
        }

        await CustomerBalanceService.createEntry({
            customer_id: customerId,
            amount: -amount,
            entry_type: 'manual_refund',
            reference_type: 'manual_refund',
            reference_id: null,
            created_by: actorId,
            note: note || 'Refund saldo customer manual',
            idempotency_key: idempotencyKey ? `balance_manual_refund_${idempotencyKey}` : null,
        }, { transaction: t });

        const paymentAcc = await Account.findOne({ where: { code: paymentAccountCode }, transaction: t });
        const customerSaldoAcc = await Account.findOne({ where: { code: '2105' }, transaction: t });
        if (!paymentAcc) {
            await t.rollback();
            throw new CustomError('Akun pembayaran tidak ditemukan', 409);
        }
        if (!customerSaldoAcc) {
            await t.rollback();
            throw new CustomError('Akun saldo customer (2105) tidak ditemukan', 409);
        }

        await JournalService.createEntry({
            description: `Manual refund saldo customer (${customerId})`,
            reference_type: 'customer_balance_manual_refund',
            reference_id: customerId,
            created_by: actorId,
            idempotency_key: idempotencyKey ? `journal_manual_refund_${idempotencyKey}` : undefined,
            lines: [
                { account_id: customerSaldoAcc.id, debit: amount, credit: 0 },
                { account_id: paymentAcc.id, debit: 0, credit: amount }
            ]
        }, t);

        const balanceAfter = await CustomerBalanceService.getBalance(customerId, { transaction: t });
        await t.commit();

        const payload = {
            message: 'Manual refund berhasil dicatat',
            customer_id: customerId,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, payload);
        }
        return res.json(payload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal mencatat manual refund', 500);
    }
});

export const manualAdjustment = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = String(req.params?.id || '').trim();
    if (!customerId) throw new CustomError('ID customer tidak valid', 400);

    const actorId = String(req.user?.id || '').trim();
    if (!actorId) throw new CustomError('Unauthorized', 401);

    const idempotencyKey = resolveIdempotencyKey(req);
    const idempotencyScope = `customer_balance_manual_adjustment:${actorId}:${customerId}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan manual adjustment duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const amountSigned = round2(toNumber((req.body as any)?.amount_signed));
        const contraAccountCode = String((req.body as any)?.contra_account_code || '').trim();
        const note = typeof (req.body as any)?.note === 'string' ? String((req.body as any).note).trim() : '';

        if (!Number.isFinite(amountSigned) || amountSigned === 0) {
            await t.rollback();
            throw new CustomError('amount_signed tidak valid', 400);
        }
        if (!contraAccountCode) {
            await t.rollback();
            throw new CustomError('contra_account_code wajib diisi', 400);
        }
        if (!note) {
            await t.rollback();
            throw new CustomError('note wajib diisi untuk adjustment', 400);
        }

        const contraAcc = await Account.findOne({ where: { code: contraAccountCode }, transaction: t });
        const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
        const customerSaldoAcc = await Account.findOne({ where: { code: '2105' }, transaction: t });
        if (!contraAcc) {
            await t.rollback();
            throw new CustomError('Akun kontra tidak ditemukan', 409);
        }
        if (!arAcc) {
            await t.rollback();
            throw new CustomError('Akun piutang usaha (1103) tidak ditemukan', 409);
        }
        if (!customerSaldoAcc) {
            await t.rollback();
            throw new CustomError('Akun saldo customer (2105) tidak ditemukan', 409);
        }

        await CustomerBalanceService.createEntry({
            customer_id: customerId,
            amount: amountSigned,
            entry_type: 'manual_adjustment',
            reference_type: 'manual_adjustment',
            reference_id: null,
            created_by: actorId,
            note,
            idempotency_key: idempotencyKey ? `balance_manual_adjustment_${idempotencyKey}` : null,
        }, { transaction: t });

        const abs = Math.abs(amountSigned);
        const lines: any[] = [];
        if (amountSigned > 0) {
            // Increase customer credit: Dr contra ; Cr 2105
            lines.push({ account_id: contraAcc.id, debit: abs, credit: 0 });
            lines.push({ account_id: customerSaldoAcc.id, debit: 0, credit: abs });
        } else {
            // Increase customer debt: Dr 1103 ; Cr contra
            lines.push({ account_id: arAcc.id, debit: abs, credit: 0 });
            lines.push({ account_id: contraAcc.id, debit: 0, credit: abs });
        }

        await JournalService.createEntry({
            description: `Manual adjustment saldo customer (${customerId})`,
            reference_type: 'customer_balance_manual_adjustment',
            reference_id: customerId,
            created_by: actorId,
            idempotency_key: idempotencyKey ? `journal_manual_adjustment_${idempotencyKey}` : undefined,
            lines
        }, t);

        const balanceAfter = await CustomerBalanceService.getBalance(customerId, { transaction: t });
        await t.commit();

        const payload = {
            message: 'Manual adjustment berhasil dicatat',
            customer_id: customerId,
            balance_after: balanceAfter,
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 200, payload);
        }
        return res.json(payload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal mencatat manual adjustment', 500);
    }
});
