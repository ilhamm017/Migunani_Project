import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Account, Invoice, InvoiceCostOverride, InvoiceItem, Journal, JournalLine, OrderItem, Product, sequelize } from '../../models';
import { JournalService } from '../../services/JournalService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

const parseMoney4OrNull = (value: unknown): number | null => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10000) / 10000;
};

const getAccountByCode = async (code: string, t?: any) =>
    Account.findOne({ where: { code }, transaction: t });

type RequestedOverride = { product_id: string; unit_cost_override: number | null };

const loadInvoiceProductIds = async (invoiceId: string, t?: any): Promise<Set<string>> => {
    const items = await InvoiceItem.findAll({
        where: { invoice_id: invoiceId },
        attributes: ['id'],
        include: [{
            model: OrderItem,
            attributes: ['product_id'],
            required: true
        }],
        transaction: t
    });
    const productIds = new Set<string>();
    (items as any[]).forEach((row: any) => {
        const productId = String(row?.OrderItem?.product_id || '').trim();
        if (productId) productIds.add(productId);
    });
    return productIds;
};

const computeTargetDeltaHpp = async (invoiceId: string, overridesByProductId: Map<string, number>, t?: any): Promise<number> => {
    const rows = await InvoiceItem.findAll({
        where: { invoice_id: invoiceId },
        attributes: ['qty', 'unit_cost'],
        include: [{
            model: OrderItem,
            attributes: ['product_id'],
            required: true
        }],
        transaction: t
    });

    const qtyByProduct = new Map<string, number>();
    const baseCostByProduct = new Map<string, number>();

    (rows as any[]).forEach((row: any) => {
        const productId = String(row?.OrderItem?.product_id || '').trim();
        if (!productId) return;
        const qty = Math.max(0, Number(row?.qty || 0));
        const unitCost = Number(row?.unit_cost || 0);
        qtyByProduct.set(productId, Number(qtyByProduct.get(productId) || 0) + qty);
        baseCostByProduct.set(productId, Number(baseCostByProduct.get(productId) || 0) + (qty * unitCost));
    });

    let deltaTotal = 0;
    qtyByProduct.forEach((qty, productId) => {
        const baseCost = Number(baseCostByProduct.get(productId) || 0);
        const override = overridesByProductId.get(productId);
        if (typeof override === 'number') {
            const overrideCost = qty * override;
            deltaTotal += (overrideCost - baseCost);
        }
    });

    // If no override for productId, delta contribution is 0 (overrideCost = baseCost).
    return Math.round(deltaTotal * 100) / 100;
};

const computeAlreadyAppliedDeltaHpp = async (invoiceId: string, hppAccountId: number, t?: any): Promise<number> => {
    const lines = await JournalLine.findAll({
        where: { account_id: hppAccountId },
        include: [{
            model: Journal,
            required: true,
            where: { reference_type: 'invoice_cogs_override', reference_id: invoiceId },
            attributes: []
        }],
        attributes: [
            [sequelize.fn('SUM', sequelize.literal('debit - credit')), 'net']
        ],
        raw: true,
        transaction: t
    }) as unknown as Array<{ net: number | string }>;
    const net = Number((lines as any)[0]?.net || 0);
    return Math.round(net * 100) / 100;
};

const postCogsOverrideJournalIfNeeded = async (params: {
    invoice: any;
    reason: string;
    actorId: string;
    targetDeltaHpp: number;
    transaction?: any;
}): Promise<{ posted: boolean; journal_id?: number; delta_hpp: number }> => {
    const t = params.transaction;
    const invoiceId = String(params.invoice?.id || '').trim();
    const invoiceNumber = String(params.invoice?.invoice_number || '').trim();

    const hppAcc = await getAccountByCode('5100', t);
    const inventoryAcc = await getAccountByCode('1300', t);
    if (!hppAcc || !inventoryAcc) {
        throw new CustomError('Akun HPP (5100) atau Inventory (1300) tidak ditemukan', 500);
    }

    const alreadyApplied = await computeAlreadyAppliedDeltaHpp(invoiceId, Number(hppAcc.id), t);
    const targetDelta = Math.round(Number(params.targetDeltaHpp || 0) * 100) / 100;
    const adjustmentNeeded = Math.round((targetDelta - alreadyApplied) * 100) / 100;

    if (Math.abs(adjustmentNeeded) <= 0.01) {
        return { posted: false, delta_hpp: targetDelta };
    }

    const cents = Math.round(targetDelta * 100);
    const idempotencyKey = `invoice_cogs_override_to_${cents}_${invoiceId}`;
    const entryDate = params.invoice?.verified_at ? new Date(params.invoice.verified_at) : new Date();

    const amount = Math.abs(adjustmentNeeded);
    const lines = adjustmentNeeded > 0
        ? [
            { account_id: Number(hppAcc.id), debit: amount, credit: 0 },
            { account_id: Number(inventoryAcc.id), debit: 0, credit: amount }
        ]
        : [
            { account_id: Number(inventoryAcc.id), debit: amount, credit: 0 },
            { account_id: Number(hppAcc.id), debit: 0, credit: amount }
        ];

    const journal = await JournalService.createAdjustmentEntry({
        date: entryDate,
        description: `[COGS OVERRIDE] Invoice #${invoiceNumber || invoiceId} · ${params.reason}`,
        reference_type: 'invoice_cogs_override',
        reference_id: invoiceId,
        created_by: params.actorId,
        idempotency_key: idempotencyKey,
        lines
    }, t);

    return { posted: true, journal_id: (journal as any)?.id, delta_hpp: targetDelta };
};

export const getInvoiceCostOverrides = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!invoiceId) throw new CustomError('invoiceId wajib diisi', 400);

    const invoice = await Invoice.findByPk(invoiceId, { attributes: ['id', 'invoice_number'] });
    if (!invoice) throw new CustomError('Invoice tidak ditemukan', 404);

    const rows = await InvoiceCostOverride.findAll({
        where: { invoice_id: invoiceId },
        include: [{ model: Product, as: 'Product', attributes: ['id', 'sku', 'name', 'unit'] }],
        order: [['updatedAt', 'DESC']]
    });

    res.json({
        invoice: { id: invoice.id, invoice_number: (invoice as any).invoice_number },
        overrides: rows.map((row: any) => row.get({ plain: true }))
    });
});

export const updateInvoiceCostOverrides = asyncWrapper(async (req: Request, res: Response) => {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const actorId = String(req.user?.id || '').trim();
    const actorRole = String(req.user?.role || '').trim();

    if (actorRole !== 'super_admin') {
        throw new CustomError('Hanya super admin yang dapat mengubah harga beli invoice.', 403);
    }
    if (!invoiceId) throw new CustomError('invoiceId wajib diisi', 400);
    if (!actorId) throw new CustomError('actor tidak valid', 403);

    const reason = String(req.body?.reason || '').trim();
    if (!reason) throw new CustomError('reason wajib diisi', 400);
    const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];

    const t = await sequelize.transaction();
    try {
        const invoice = await Invoice.findByPk(invoiceId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!invoice) throw new CustomError('Invoice tidak ditemukan', 404);

        const productIdsInInvoice = await loadInvoiceProductIds(invoiceId, t);
        if (productIdsInInvoice.size === 0) throw new CustomError('Invoice tidak memiliki item untuk di-override.', 409);

        const requested: RequestedOverride[] = [];
        for (const raw of overrides as any[]) {
            const product_id = String(raw?.product_id || '').trim();
            if (!product_id) continue;
            if (raw?.unit_cost_override === null) {
                requested.push({ product_id, unit_cost_override: null });
                continue;
            }
            const parsed = parseMoney4OrNull(raw?.unit_cost_override);
            if (parsed === null) {
                throw new CustomError(`unit_cost_override tidak valid untuk product_id ${product_id}`, 400);
            }
            requested.push({ product_id, unit_cost_override: parsed });
        }

        for (const row of requested) {
            if (!productIdsInInvoice.has(row.product_id)) {
                throw new CustomError(`product_id ${row.product_id} tidak ditemukan dalam invoice ini.`, 400);
            }
            if (row.unit_cost_override !== null && row.unit_cost_override < 0) {
                throw new CustomError('unit_cost_override tidak boleh negatif', 400);
            }
        }

        for (const row of requested) {
            if (row.unit_cost_override === null) {
                await InvoiceCostOverride.destroy({
                    where: { invoice_id: invoiceId, product_id: row.product_id },
                    transaction: t
                });
                continue;
            }
            const existing = await InvoiceCostOverride.findOne({
                where: { invoice_id: invoiceId, product_id: row.product_id },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            if (existing) {
                await existing.update({
                    unit_cost_override: row.unit_cost_override,
                    reason,
                    updated_by: actorId
                }, { transaction: t });
            } else {
                await InvoiceCostOverride.create({
                    invoice_id: invoiceId,
                    product_id: row.product_id,
                    unit_cost_override: row.unit_cost_override,
                    reason,
                    created_by: actorId,
                    updated_by: actorId
                }, { transaction: t });
            }
        }

        const effective = await InvoiceCostOverride.findAll({
            where: { invoice_id: invoiceId },
            transaction: t
        });
        const overridesByProductId = new Map<string, number>();
        (effective as any[]).forEach((row: any) => {
            const productId = String(row?.product_id || '').trim();
            if (!productId) return;
            const parsed = parseMoney4OrNull(row?.unit_cost_override);
            if (parsed === null) return;
            overridesByProductId.set(productId, parsed);
        });

        const targetDeltaHpp = await computeTargetDeltaHpp(invoiceId, overridesByProductId, t);
        const journal = await postCogsOverrideJournalIfNeeded({
            invoice,
            reason,
            actorId,
            targetDeltaHpp,
            transaction: t
        });

        await t.commit();

        const enrichedOverrides = await InvoiceCostOverride.findAll({
            where: { invoice_id: invoiceId },
            include: [{ model: Product, as: 'Product', attributes: ['id', 'sku', 'name', 'unit'] }],
            order: [['updatedAt', 'DESC']]
        });

        res.json({
            effective_overrides: enrichedOverrides.map((row: any) => row.get({ plain: true })),
            journal
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});
