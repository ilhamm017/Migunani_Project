import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Account, PosSale, PosSaleItem, Product, StockMutation, sequelize } from '../../models';
import { JournalService } from '../../services/JournalService';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

const round2 = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

type CreatePosSaleItemInput = {
    product_id: string;
    qty: number;
    unit_price_override?: number;
    override_reason?: string;
};

const parseItems = (raw: unknown): Array<{ product_id: string; qty: number; unit_price_override: number | null; override_reason: string | null }> => {
    const incoming = Array.isArray(raw) ? raw : [];
    const byProduct = new Map<string, { qty: number; unit_price_override: number | null; override_reason: string | null }>();

    for (const row of incoming as CreatePosSaleItemInput[]) {
        const productId = String((row as any)?.product_id || '').trim();
        const qtyRaw = Number((row as any)?.qty);
        const overrideRaw = (row as any)?.unit_price_override;
        const reasonRaw = String((row as any)?.override_reason || '').trim();

        if (!productId) throw new CustomError('product_id wajib diisi', 400);
        if (!Number.isFinite(qtyRaw) || qtyRaw <= 0) throw new CustomError(`qty tidak valid untuk produk ${productId}`, 400);
        const qty = Math.trunc(qtyRaw);
        if (qty <= 0) throw new CustomError(`qty tidak valid untuk produk ${productId}`, 400);

        const unitPriceOverride = overrideRaw === undefined || overrideRaw === null || overrideRaw === ''
            ? null
            : Number(overrideRaw);
        if (unitPriceOverride !== null && (!Number.isFinite(unitPriceOverride) || unitPriceOverride <= 0)) {
            throw new CustomError(`unit_price_override tidak valid untuk produk ${productId}`, 400);
        }

        const existing = byProduct.get(productId);
        if (!existing) {
            byProduct.set(productId, { qty, unit_price_override: unitPriceOverride, override_reason: reasonRaw || null });
            continue;
        }

        if (existing.unit_price_override !== unitPriceOverride) {
            throw new CustomError(`unit_price_override berbeda untuk produk yang sama (${productId}).`, 400);
        }
        existing.qty += qty;
        if (!existing.override_reason && reasonRaw) existing.override_reason = reasonRaw;
    }

    return Array.from(byProduct.entries()).map(([product_id, v]) => ({
        product_id,
        qty: v.qty,
        unit_price_override: v.unit_price_override,
        override_reason: v.override_reason,
    }));
};

const getAccountByCode = async (code: string, t: any) => Account.findOne({ where: { code }, transaction: t });

export const createPosSale = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const idempotencyScope = `pos_sale:${String(req.user?.id || '')}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan POS duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const userId = String(req.user?.id || '').trim();
        const userRole = String(req.user?.role || '').trim();
        if (!userId) {
            await t.rollback();
            throw new CustomError('Tidak terautentikasi.', 401);
        }
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Tidak memiliki akses POS.', 403);
        }

        const customerName = typeof req.body?.customer_name === 'string' && req.body.customer_name.trim()
            ? req.body.customer_name.trim()
            : null;
        const note = typeof req.body?.note === 'string' && req.body.note.trim()
            ? req.body.note.trim()
            : null;

        const discountPercentRaw = req.body?.discount_percent;
        const discountPercent = discountPercentRaw === undefined || discountPercentRaw === null || discountPercentRaw === ''
            ? 0
            : Number(discountPercentRaw);
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
            await t.rollback();
            throw new CustomError('discount_percent tidak valid (0-100)', 400);
        }

        const amountReceivedRaw = req.body?.amount_received;
        const amountReceived = round2(amountReceivedRaw);
        if (!Number.isFinite(amountReceived) || amountReceived < 0) {
            await t.rollback();
            throw new CustomError('amount_received tidak valid', 400);
        }

        const items = parseItems(req.body?.items);
        if (items.length === 0) {
            await t.rollback();
            throw new CustomError('items wajib diisi', 400);
        }

        const productIds = items.map((it) => it.product_id);
        const products = await Product.findAll({
            where: { id: { [Op.in]: productIds } },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        if (products.length !== productIds.length) {
            const found = new Set(products.map((p: any) => String(p.id)));
            const missing = productIds.filter((id) => !found.has(id));
            await t.rollback();
            throw new CustomError(`Produk tidak ditemukan: ${missing.join(', ')}`, 404);
        }
        const productById = new Map<string, any>();
        products.forEach((p: any) => productById.set(String(p.id), p));

        const stockErrors: string[] = [];
        for (const it of items) {
            const product = productById.get(it.product_id);
            const available = Number(product?.stock_quantity || 0);
            if (available < it.qty) {
                stockErrors.push(`${String(product?.sku || it.product_id)} (${String(product?.name || 'Produk')}): stok ${available}, diminta ${it.qty}`);
            }
        }
        if (stockErrors.length > 0) {
            await t.rollback();
            throw new CustomError(`Stok tidak cukup:\n- ${stockErrors.join('\n- ')}`, 400);
        }

        type Line = {
            product: any;
            product_id: string;
            qty: number;
            unit_price: number;
            line_total: number;
            unit_price_override: number | null;
            override_reason: string | null;
        };
        const lines: Line[] = [];
        let subtotal = 0;

        for (const it of items) {
            const product = productById.get(it.product_id);
            const normalPrice = round2(product?.price);
            const baseCost = round2(product?.base_price);

            let unitPrice = normalPrice;
            if (it.unit_price_override !== null) {
                const override = round2(it.unit_price_override);
                if (override > normalPrice) {
                    await t.rollback();
                    throw new CustomError(`Harga override tidak boleh lebih tinggi dari harga normal untuk ${String(product?.sku || it.product_id)}`, 400);
                }
                if (userRole === 'kasir' && override < baseCost) {
                    await t.rollback();
                    throw new CustomError(`Kasir tidak boleh menurunkan harga di bawah modal untuk ${String(product?.sku || it.product_id)}`, 400);
                }
                unitPrice = override;
            }

            const lineTotal = round2(unitPrice * it.qty);
            subtotal = round2(subtotal + lineTotal);
            lines.push({
                product,
                product_id: it.product_id,
                qty: it.qty,
                unit_price: unitPrice,
                line_total: lineTotal,
                unit_price_override: it.unit_price_override,
                override_reason: it.override_reason,
            });
        }

        const discountAmount = Math.min(
            subtotal,
            round2(subtotal * (discountPercent / 100))
        );
        const subtotalBase = Math.max(0, round2(subtotal - discountAmount));
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);
        const taxPercent = round2(computedTax.tax_percent);
        const taxAmount = round2(computedTax.tax_amount);
        const total = round2(computedTax.total);

        if (amountReceived < total) {
            await t.rollback();
            throw new CustomError(`Uang diterima kurang. Total: ${total}`, 400);
        }
        const changeAmount = round2(amountReceived - total);

        const paidAt = new Date();
        const sale = await PosSale.create({
            cashier_user_id: userId,
            customer_name: customerName,
            note,
            status: 'paid',
            subtotal,
            discount_amount: discountAmount,
            discount_percent: discountPercent,
            tax_percent: taxPercent,
            tax_amount: taxAmount,
            total,
            amount_received: amountReceived,
            change_amount: changeAmount,
            paid_at: paidAt,
        }, { transaction: t });

        await sale.reload({ transaction: t });
        const receiptNumber = String((sale as any).receipt_number || '').trim() || null;

        const itemRows: any[] = [];
        let totalCogs = 0;

        for (const line of lines) {
            const product = line.product;
            const currentStock = Number(product?.stock_quantity || 0);
            const newStock = currentStock - line.qty;
            if (newStock < 0) {
                await t.rollback();
                throw new CustomError(`Stok tidak cukup untuk ${String(product?.sku || line.product_id)}`, 400);
            }

            await product.update({ stock_quantity: newStock }, { transaction: t });

            await StockMutation.create({
                product_id: line.product_id,
                type: 'out',
                qty: -Math.abs(line.qty),
                reference_id: String(sale.id),
                note: `POS sale ${receiptNumber || String(sale.id).slice(-8)}`
            }, { transaction: t });

            const valuation = await InventoryCostService.consumeOutbound({
                product_id: line.product_id,
                qty: line.qty,
                reference_type: 'pos_sale',
                reference_id: String(sale.id),
                note: `POS sale ${receiptNumber || String(sale.id).slice(-8)}`,
                transaction: t
            });

            const unitCost = Number(valuation.unit_cost || 0);
            const cogsTotal = Number(valuation.total_cost || 0);
            totalCogs += cogsTotal;

            itemRows.push({
                pos_sale_id: String(sale.id),
                product_id: line.product_id,
                sku_snapshot: String(product?.sku || ''),
                name_snapshot: String(product?.name || ''),
                unit_snapshot: String(product?.unit || 'Pcs'),
                qty: line.qty,
                unit_price: line.unit_price,
                line_total: line.line_total,
                unit_cost: unitCost,
                cogs_total: cogsTotal
            });
        }

        await PosSaleItem.bulkCreate(itemRows, { transaction: t });

        // Optional: journaling
        try {
            const cashAcc = await getAccountByCode('1101', t);
            const revenueAcc = await getAccountByCode('4100', t);
            const vatAcc = await getAccountByCode('2201', t);
            const hppAcc = await getAccountByCode('5100', t);
            const inventoryAcc = await getAccountByCode('1300', t);

            const dpp = Math.max(0, round2(total - taxAmount));

            if (cashAcc && revenueAcc && (dpp > 0 || taxAmount > 0)) {
                const journalLines: any[] = [];
                journalLines.push({ account_id: cashAcc.id, debit: total, credit: 0 });
                if (dpp > 0) journalLines.push({ account_id: revenueAcc.id, debit: 0, credit: dpp });
                if (taxAmount > 0 && vatAcc) journalLines.push({ account_id: vatAcc.id, debit: 0, credit: taxAmount });

                if (journalLines.length >= 2) {
                    await JournalService.createEntry({
                        description: `POS Sale Settlement ${receiptNumber || String(sale.id).slice(-8)}`,
                        reference_type: 'pos_sale',
                        reference_id: String(sale.id),
                        created_by: userId,
                        idempotency_key: `pos_sale_settlement_${sale.id}`,
                        lines: journalLines
                    }, t);
                }
            }

            const safeCogs = Math.max(0, Number(totalCogs || 0));
            if (hppAcc && inventoryAcc && safeCogs > 0) {
                await JournalService.createEntry({
                    description: `POS Sale HPP ${receiptNumber || String(sale.id).slice(-8)}`,
                    reference_type: 'pos_sale',
                    reference_id: String(sale.id),
                    created_by: userId,
                    idempotency_key: `pos_sale_cogs_${sale.id}`,
                    lines: [
                        { account_id: hppAcc.id, debit: safeCogs, credit: 0 },
                        { account_id: inventoryAcc.id, debit: 0, credit: safeCogs }
                    ]
                }, t);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('POS journaling skipped:', e);
        }

        await t.commit();

        const responsePayload = {
            id: sale.id,
            receipt_number: receiptNumber,
            total,
            amount_received: amountReceived,
            change_amount: changeAmount
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 201, responsePayload);
        }
        return res.status(201).json(responsePayload);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal membuat transaksi POS', 500);
    }
});

export const listPosSales = asyncWrapper(async (req: Request, res: Response) => {
    const page = Math.max(1, Number((req.query as any)?.page || 1) || 1);
    const rawLimit = Number((req.query as any)?.limit || 20) || 20;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const q = String((req.query as any)?.q || '').trim();
    const status = String((req.query as any)?.status || '').trim().toLowerCase();
    const cashierUserId = String((req.query as any)?.cashier_user_id || '').trim();
    const startDateRaw = String((req.query as any)?.startDate || '').trim();
    const endDateRaw = String((req.query as any)?.endDate || '').trim();

    const start = startDateRaw ? new Date(startDateRaw) : new Date();
    const end = endDateRaw ? new Date(endDateRaw) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new CustomError('startDate/endDate tidak valid', 400);
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const andClauses: any[] = [];
    andClauses.push({ paid_at: { [Op.between]: [start, end] } });
    if (q) {
        andClauses.push({
            [Op.or]: [
                { receipt_number: { [Op.like]: `%${q}%` } },
                { customer_name: { [Op.like]: `%${q}%` } },
                ...(q.length >= 8 ? [{ id: q }] : [])
            ]
        });
    }
    if (status && ['paid', 'voided'].includes(status)) andClauses.push({ status });
    if (cashierUserId) andClauses.push({ cashier_user_id: cashierUserId });

    const where = andClauses.length > 0 ? { [Op.and]: andClauses } : {};

    const result = await PosSale.findAndCountAll({
        where,
        include: [{
            association: 'Cashier' as any,
            attributes: ['id', 'name', 'role'],
            required: false,
        }],
        order: [['paid_at', 'DESC'], ['createdAt', 'DESC']],
        limit,
        offset,
    });

    res.json({
        page,
        limit,
        total: result.count,
        rows: result.rows.map((row: any) => row.get({ plain: true })),
        period: {
            start: start.toISOString(),
            end: end.toISOString(),
        }
    });
});

export const getPosSaleById = asyncWrapper(async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) throw new CustomError('id tidak valid', 400);

    const sale = await PosSale.findByPk(id, {
        include: [
            {
                association: 'Cashier' as any,
                attributes: ['id', 'name', 'role'],
                required: false
            }
        ]
    });

    if (!sale) throw new CustomError('Transaksi POS tidak ditemukan', 404);

    const items = await PosSaleItem.findAll({
        where: { pos_sale_id: id },
        order: [['id', 'ASC']]
    });

    const payload: any = sale.get({ plain: true });
    payload.Items = items.map((row: any) => row.get({ plain: true }));

    res.json(payload);
});

export const voidPosSale = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = String(req.user?.id || '').trim();
        const userRole = String(req.user?.role || '').trim();
        if (!userId) {
            await t.rollback();
            throw new CustomError('Tidak terautentikasi.', 401);
        }
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            throw new CustomError('Tidak memiliki akses POS.', 403);
        }

        const id = String(req.params.id || '').trim();
        const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim()
            : null;
        if (!id) {
            await t.rollback();
            throw new CustomError('id tidak valid', 400);
        }

        const sale = await PosSale.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!sale) {
            await t.rollback();
            throw new CustomError('Transaksi POS tidak ditemukan', 404);
        }
        if (String((sale as any).status) !== 'paid') {
            await t.rollback();
            throw new CustomError('Transaksi POS sudah di-void atau tidak valid untuk void.', 409);
        }

        const items = await PosSaleItem.findAll({
            where: { pos_sale_id: id },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (items.length === 0) {
            await t.rollback();
            throw new CustomError('Item POS tidak ditemukan.', 409);
        }

        const productIds = Array.from(new Set(items.map((it: any) => String(it.product_id))));
        const products = await Product.findAll({
            where: { id: { [Op.in]: productIds } },
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (products.length !== productIds.length) {
            await t.rollback();
            throw new CustomError('Beberapa produk untuk item POS tidak ditemukan.', 409);
        }
        const productById = new Map<string, any>();
        products.forEach((p: any) => productById.set(String(p.id), p));

        const receiptNumber = String((sale as any).receipt_number || '').trim() || null;

        let totalCogs = 0;
        for (const item of items as any[]) {
            const productId = String(item.product_id);
            const product = productById.get(productId);
            const qty = Math.max(0, Math.trunc(Number(item.qty || 0)));
            if (!product || qty <= 0) continue;

            await product.update({
                stock_quantity: Number(product.stock_quantity || 0) + qty
            }, { transaction: t });

            await StockMutation.create({
                product_id: productId,
                type: 'in',
                qty: Math.abs(qty),
                reference_id: String(sale.id),
                note: `VOID POS sale ${receiptNumber || String(sale.id).slice(-8)}`
            }, { transaction: t });

            await InventoryCostService.recordInbound({
                product_id: productId,
                qty,
                unit_cost: Number(item.unit_cost || 0),
                reference_type: 'pos_sale_void',
                reference_id: String(sale.id),
                note: `VOID POS sale ${receiptNumber || String(sale.id).slice(-8)}`,
                transaction: t
            });

            totalCogs += Number(item.cogs_total || 0);
        }

        await sale.update({
            status: 'voided',
            voided_at: new Date(),
            voided_by: userId,
            void_reason: reason
        }, { transaction: t });

        // Optional: journal reversals
        try {
            const cashAcc = await getAccountByCode('1101', t);
            const revenueAcc = await getAccountByCode('4100', t);
            const vatAcc = await getAccountByCode('2201', t);
            const hppAcc = await getAccountByCode('5100', t);
            const inventoryAcc = await getAccountByCode('1300', t);

            const total = round2((sale as any).total);
            const taxAmount = round2((sale as any).tax_amount);
            const dpp = Math.max(0, round2(total - taxAmount));

            if (cashAcc && revenueAcc && (dpp > 0 || taxAmount > 0)) {
                const journalLines: any[] = [];
                if (dpp > 0) journalLines.push({ account_id: revenueAcc.id, debit: dpp, credit: 0 });
                if (taxAmount > 0 && vatAcc) journalLines.push({ account_id: vatAcc.id, debit: taxAmount, credit: 0 });
                journalLines.push({ account_id: cashAcc.id, debit: 0, credit: total });

                if (journalLines.length >= 2) {
                    await JournalService.createEntry({
                        description: `VOID POS Sale Settlement ${receiptNumber || String(sale.id).slice(-8)}`,
                        reference_type: 'pos_sale_void',
                        reference_id: String(sale.id),
                        created_by: userId,
                        idempotency_key: `pos_sale_void_settlement_${sale.id}`,
                        lines: journalLines
                    }, t);
                }
            }

            const safeCogs = Math.max(0, Number(totalCogs || 0));
            if (hppAcc && inventoryAcc && safeCogs > 0) {
                await JournalService.createEntry({
                    description: `VOID POS Sale HPP ${receiptNumber || String(sale.id).slice(-8)}`,
                    reference_type: 'pos_sale_void',
                    reference_id: String(sale.id),
                    created_by: userId,
                    idempotency_key: `pos_sale_void_cogs_${sale.id}`,
                    lines: [
                        { account_id: inventoryAcc.id, debit: safeCogs, credit: 0 },
                        { account_id: hppAcc.id, debit: 0, credit: safeCogs }
                    ]
                }, t);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('POS void journaling skipped:', e);
        }

        await t.commit();
        res.json({ message: 'Transaksi POS berhasil di-void.', id: sale.id });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal void transaksi POS', 500);
    }
});
