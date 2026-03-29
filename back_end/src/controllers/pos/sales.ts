import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { Account, Category, ClearancePromo, CustomerProfile, InventoryBatch, PosSale, PosSaleItem, Product, StockMutation, User, sequelize } from '../../models';
import { JournalService } from '../../services/JournalService';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';
import { resolveEffectiveTierPricing } from '../order/utils';

const round2 = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;
const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
const joinError = (e: unknown) => {
    if (e instanceof Error) return e.message;
    if (typeof e === 'string') return e;
    try { return JSON.stringify(e); } catch { }
    return String(e);
};

type CreatePosSaleItemInput = {
    product_id: string;
    qty: number;
    clearance_promo_id?: string;
    unit_price_override?: number;
    override_reason?: string;
};

const parseItems = (raw: unknown): Array<{ product_id: string; qty: number; clearance_promo_id: string | null; unit_price_override: number | null; override_reason: string | null }> => {
    const incoming = Array.isArray(raw) ? raw : [];
    const byProduct = new Map<string, { qty: number; clearance_promo_id: string | null; unit_price_override: number | null; override_reason: string | null }>();

    for (const row of incoming as CreatePosSaleItemInput[]) {
        const productId = String((row as any)?.product_id || '').trim();
        const qtyRaw = Number((row as any)?.qty);
        const clearancePromoIdRaw = typeof (row as any)?.clearance_promo_id === 'string'
            ? String((row as any).clearance_promo_id).trim()
            : '';
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

        const clearancePromoId = clearancePromoIdRaw || null;
        if (clearancePromoId && unitPriceOverride !== null) {
            throw new CustomError(`Tidak boleh mengisi unit_price_override jika memakai clearance promo (${productId}).`, 400);
        }

        const existing = byProduct.get(productId);
        if (!existing) {
            byProduct.set(productId, { qty, clearance_promo_id: clearancePromoId, unit_price_override: unitPriceOverride, override_reason: reasonRaw || null });
            continue;
        }

        if (existing.clearance_promo_id !== clearancePromoId) {
            throw new CustomError(`clearance_promo_id berbeda untuk produk yang sama (${productId}).`, 400);
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
        clearance_promo_id: v.clearance_promo_id,
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

        const customerIdRaw = typeof req.body?.customer_id === 'string' ? req.body.customer_id.trim() : '';
        const customerId = customerIdRaw || null;
        const customer = customerId
            ? await User.findOne({
                where: { id: customerId, role: 'customer' },
                include: [{ model: CustomerProfile, attributes: ['tier'], required: false }],
                transaction: t,
                lock: t.LOCK.SHARE
            })
            : null;
        const customerName = customer ? String((customer as any).name || '').trim() || null : null;
        const customerTier = customer && (customer as any).CustomerProfile && typeof (customer as any).CustomerProfile.tier === 'string'
            ? String((customer as any).CustomerProfile.tier || '').trim().toLowerCase() || 'regular'
            : 'regular';
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
            include: [{ model: Category, attributes: ['id', 'name', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'], required: false }],
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
            clearance_promo_id: string | null;
        };
        const lines: Line[] = [];
        let subtotal = 0;
        const promoById = new Map<string, any>();
        const promoUsedQtyCache = new Map<string, number>();

        const getPromoUsedQty = async (promoId: string): Promise<number> => {
            const id = String(promoId || '').trim();
            if (!id) return 0;
            if (promoUsedQtyCache.has(id)) return promoUsedQtyCache.get(id) || 0;

            const orderRows = await sequelize.query(
                `SELECT COALESCE(SUM(oi.qty), 0) AS qty_used
                 FROM order_items oi
                 INNER JOIN orders o ON o.id = oi.order_id
                 WHERE oi.clearance_promo_id = :promoId
                   AND o.status NOT IN ('canceled', 'expired')`,
                { type: QueryTypes.SELECT, replacements: { promoId: id }, transaction: t }
            ) as any[];

            const posRows = await sequelize.query(
                `SELECT COALESCE(SUM(psi.qty), 0) AS qty_used
                 FROM pos_sale_items psi
                 INNER JOIN pos_sales ps ON ps.id = psi.pos_sale_id
                 WHERE psi.clearance_promo_id = :promoId
                   AND ps.status = 'paid'`,
                { type: QueryTypes.SELECT, replacements: { promoId: id }, transaction: t }
            ) as any[];

            const used = Math.max(0, Math.trunc(Number((orderRows?.[0] as any)?.qty_used || 0))) +
                Math.max(0, Math.trunc(Number((posRows?.[0] as any)?.qty_used || 0)));
            promoUsedQtyCache.set(id, used);
            return used;
        };

        for (const it of items) {
            const product = productById.get(it.product_id);
            const basePrice = Number(product?.price);
            const pricing = resolveEffectiveTierPricing(basePrice, String(customerTier || 'regular'), product?.varian_harga, (product as any).Category);
            const normalPrice = round2(pricing.finalPrice);
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

            const clearancePromoId = String((it as any)?.clearance_promo_id || '').trim() || null;
            if (!clearancePromoId) {
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
                    clearance_promo_id: null,
                });
                continue;
            }

            const promo = await ClearancePromo.findByPk(clearancePromoId, { transaction: t, lock: t.LOCK.SHARE });
            if (!promo) {
                await t.rollback();
                throw new CustomError('Clearance promo tidak ditemukan atau sudah tidak aktif.', 404);
            }
            if (String((promo as any).product_id) !== String(product?.id)) {
                await t.rollback();
                throw new CustomError('Clearance promo tidak cocok untuk produk ini.', 400);
            }
            if (!(promo as any).is_active) {
                await t.rollback();
                throw new CustomError('Clearance promo sedang non-aktif.', 400);
            }
            const now = Date.now();
            const startsAt = new Date((promo as any).starts_at || 0).getTime();
            const endsAt = new Date((promo as any).ends_at || 0).getTime();
            if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || now < startsAt || now > endsAt) {
                await t.rollback();
                throw new CustomError('Clearance promo belum berlaku atau sudah berakhir.', 400);
            }

            promoById.set(clearancePromoId, promo);

            const pricingMode = String((promo as any).pricing_mode || '');
            let promoUnitPrice = 0;
            if (pricingMode === 'fixed_price') {
                promoUnitPrice = round2((promo as any).promo_unit_price);
                if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) {
                    await t.rollback();
                    throw new CustomError('promo_unit_price tidak valid untuk clearance promo.', 400);
                }
            } else if (pricingMode === 'percent_off') {
                const pct = Number((promo as any).discount_pct || 0);
                if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
                    await t.rollback();
                    throw new CustomError('discount_pct tidak valid untuk clearance promo.', 400);
                }
                promoUnitPrice = Math.round(normalPrice * (1 - (pct / 100)));
                promoUnitPrice = round2(promoUnitPrice);
            } else {
                await t.rollback();
                throw new CustomError('pricing_mode tidak valid untuk clearance promo.', 400);
            }

            const targetUnitCost = round4((promo as any).target_unit_cost);
            const remainingAgg = await InventoryBatch.findOne({
                where: {
                    product_id: it.product_id,
                    unit_cost: targetUnitCost,
                    qty_on_hand: { [Op.gt]: 0 }
                },
                attributes: [[sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum']],
                transaction: t,
                lock: t.LOCK.UPDATE,
                raw: true,
            }) as any;
            const remainingQty = Math.max(0, Math.trunc(Number(remainingAgg?.qty_sum || 0)));
            const qtyLimit = (promo as any).qty_limit === null || (promo as any).qty_limit === undefined
                ? null
                : Math.max(0, Math.trunc(Number((promo as any).qty_limit || 0)));
            const qtyUsed = qtyLimit === null ? 0 : await getPromoUsedQty(String((promo as any).id));
            const remainingByLimit = qtyLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, qtyLimit - qtyUsed);
            const effectiveRemaining = Math.max(0, Math.min(remainingQty, remainingByLimit));

            const promoQty = Math.max(0, Math.min(it.qty, effectiveRemaining));
            const normalQty = Math.max(0, it.qty - promoQty);

            if (promoQty > 0) {
                const promoLineTotal = round2(promoUnitPrice * promoQty);
                subtotal = round2(subtotal + promoLineTotal);
                lines.push({
                    product,
                    product_id: it.product_id,
                    qty: promoQty,
                    unit_price: promoUnitPrice,
                    line_total: promoLineTotal,
                    unit_price_override: null,
                    override_reason: null,
                    clearance_promo_id: clearancePromoId,
                });
            }
            if (normalQty > 0) {
                const normalLineTotal = round2(normalPrice * normalQty);
                subtotal = round2(subtotal + normalLineTotal);
                lines.push({
                    product,
                    product_id: it.product_id,
                    qty: normalQty,
                    unit_price: normalPrice,
                    line_total: normalLineTotal,
                    unit_price_override: null,
                    override_reason: null,
                    clearance_promo_id: null,
                });
            }
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

        const changeAmount = round2(amountReceived - total);
        const isUnderpay = changeAmount < 0;
        if (isUnderpay && !customer) {
            await t.rollback();
            throw new CustomError('Transaksi hutang wajib memilih customer yang terdaftar.', 400);
        }

        const paidAt = new Date();
        const sale = await PosSale.create({
            cashier_user_id: userId,
            customer_id: customer ? String((customer as any).id) : null,
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

        const totalQtyByProduct = new Map<string, number>();
        for (const line of lines) {
            const prev = Number(totalQtyByProduct.get(line.product_id) || 0);
            totalQtyByProduct.set(line.product_id, prev + Math.max(0, Math.trunc(Number(line.qty || 0))));
        }

        for (const [productId, qty] of totalQtyByProduct.entries()) {
            const product = productById.get(productId);
            const currentStock = Number(product?.stock_quantity || 0);
            const newStock = currentStock - qty;
            if (newStock < 0) {
                await t.rollback();
                throw new CustomError(`Stok tidak cukup untuk ${String(product?.sku || productId)}`, 400);
            }

            await product.update({ stock_quantity: newStock }, { transaction: t });

            await StockMutation.create({
                product_id: productId,
                type: 'out',
                qty: -Math.abs(qty),
                reference_type: 'pos_sale',
                reference_id: String(sale.id),
                note: `POS sale ${receiptNumber || String(sale.id).slice(-8)}`
            }, { transaction: t });
        }

        for (const line of lines) {
            const product = line.product;
            const basePrice = Number(product?.price);
            const pricing = resolveEffectiveTierPricing(basePrice, String(customerTier || 'regular'), product?.varian_harga, (product as any).Category);
            const normalPrice = round2(pricing.finalPrice);

            const clearancePromoId = String(line.clearance_promo_id || '').trim();
            const valuation = clearancePromoId
                ? await InventoryCostService.consumeOutboundPreferUnitCost({
                    product_id: line.product_id,
                    qty: line.qty,
                    preferred_unit_cost: Number((promoById.get(clearancePromoId) as any)?.target_unit_cost || 0),
                    reference_type: 'pos_sale',
                    reference_id: String(sale.id),
                    note: `POS sale ${receiptNumber || String(sale.id).slice(-8)} (clearance promo)`,
                    transaction: t
                })
                : await InventoryCostService.consumeOutbound({
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
                clearance_promo_id: line.clearance_promo_id,
                sku_snapshot: String(product?.sku || ''),
                name_snapshot: String(product?.name || ''),
                unit_snapshot: String(product?.unit || 'Pcs'),
                qty: line.qty,
                unit_price_normal_snapshot: normalPrice,
                unit_price_override: line.unit_price_override,
                override_reason: line.override_reason,
                unit_price: line.unit_price,
                line_total: line.line_total,
                unit_cost: unitCost,
                cogs_total: cogsTotal
            });
        }

        await PosSaleItem.bulkCreate(itemRows, { transaction: t });

        // Journaling (tracked on pos_sales)
        const journalErrors: string[] = [];
        try {
            const cashAcc = await getAccountByCode('1101', t);
            const arAcc = await getAccountByCode('1103', t);
            const revenueAcc = await getAccountByCode('4100', t);
            const vatAcc = await getAccountByCode('2201', t);
            const hppAcc = await getAccountByCode('5100', t);
            const inventoryAcc = await getAccountByCode('1300', t);

            const dpp = Math.max(0, round2(total - taxAmount));

            // Settlement
            if (!cashAcc) journalErrors.push('Akun kas (1101) tidak ditemukan');
            if (!revenueAcc) journalErrors.push('Akun penjualan (4100) tidak ditemukan');
            if (taxAmount > 0 && !vatAcc) journalErrors.push('Akun PPN keluaran (2201) tidak ditemukan');
            const underpay = changeAmount < 0;
            if (underpay && !arAcc) journalErrors.push('Akun piutang usaha (1103) tidak ditemukan untuk transaksi kurang bayar');

            if (journalErrors.length === 0 && cashAcc && revenueAcc) {
                const journalLines: any[] = [];
                if (!underpay) {
                    journalLines.push({ account_id: cashAcc.id, debit: total, credit: 0 });
                } else {
                    journalLines.push({ account_id: cashAcc.id, debit: amountReceived, credit: 0 });
                    journalLines.push({ account_id: arAcc!.id, debit: round2(total - amountReceived), credit: 0 });
                }
                if (dpp > 0) journalLines.push({ account_id: revenueAcc.id, debit: 0, credit: dpp });
                if (taxAmount > 0) journalLines.push({ account_id: vatAcc!.id, debit: 0, credit: taxAmount });

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

            // COGS
            const safeCogs = Math.max(0, Number(totalCogs || 0));
            if (safeCogs > 0) {
                if (!hppAcc || !inventoryAcc) {
                    journalErrors.push('Akun HPP (5100) atau persediaan (1300) tidak ditemukan');
                } else {
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
            }
        } catch (e) {
            journalErrors.push(joinError(e));
        }

        if (journalErrors.length === 0) {
            await sale.update({
                journal_status: 'posted',
                journal_posted_at: new Date(),
                journal_error: null
            }, { transaction: t });
        } else {
            await sale.update({
                journal_status: 'failed',
                journal_posted_at: null,
                journal_error: journalErrors.slice(0, 8).join('\n')
            }, { transaction: t });
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
    if (status && ['paid', 'voided', 'refunded'].includes(status)) andClauses.push({ status });
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

export const refundPosSale = asyncWrapper(async (req: Request, res: Response) => {
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
            throw new CustomError('Transaksi POS sudah direfund atau tidak valid untuk refund.', 409);
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
                reference_type: 'pos_sale_refund',
                reference_id: String(sale.id),
                note: `REFUND POS sale ${receiptNumber || String(sale.id).slice(-8)}`
            }, { transaction: t });

            await InventoryCostService.recordInbound({
                product_id: productId,
                qty,
                unit_cost: Number(item.unit_cost || 0),
                reference_type: 'pos_sale_refund',
                reference_id: String(sale.id),
                note: `REFUND POS sale ${receiptNumber || String(sale.id).slice(-8)}`,
                transaction: t
            });

            totalCogs += Number(item.cogs_total || 0);
        }

        await sale.update({
            status: 'refunded',
            refunded_at: new Date(),
            refunded_by: userId,
            refund_reason: reason
        }, { transaction: t });

        // Journal reversals (tracked on pos_sales)
        const journalErrors: string[] = [];
        try {
            const cashAcc = await getAccountByCode('1101', t);
            const arAcc = await getAccountByCode('1103', t);
            const revenueAcc = await getAccountByCode('4100', t);
            const vatAcc = await getAccountByCode('2201', t);
            const hppAcc = await getAccountByCode('5100', t);
            const inventoryAcc = await getAccountByCode('1300', t);

            const total = round2((sale as any).total);
            const amountReceived = round2((sale as any).amount_received);
            const taxAmount = round2((sale as any).tax_amount);
            const dpp = Math.max(0, round2(total - taxAmount));
            const underpay = amountReceived < total;

            if (!cashAcc) journalErrors.push('Akun kas (1101) tidak ditemukan');
            if (!revenueAcc) journalErrors.push('Akun penjualan (4100) tidak ditemukan');
            if (taxAmount > 0 && !vatAcc) journalErrors.push('Akun PPN keluaran (2201) tidak ditemukan');
            if (underpay && !arAcc) journalErrors.push('Akun piutang usaha (1103) tidak ditemukan untuk refund transaksi kurang bayar');

            if (journalErrors.length === 0 && cashAcc && revenueAcc && (dpp > 0 || taxAmount > 0)) {
                const journalLines: any[] = [];
                if (dpp > 0) journalLines.push({ account_id: revenueAcc.id, debit: dpp, credit: 0 });
                if (taxAmount > 0 && vatAcc) journalLines.push({ account_id: vatAcc.id, debit: taxAmount, credit: 0 });
                const cashCredit = underpay ? amountReceived : total;
                journalLines.push({ account_id: cashAcc.id, debit: 0, credit: cashCredit });
                if (underpay) {
                    journalLines.push({ account_id: arAcc!.id, debit: 0, credit: round2(total - amountReceived) });
                }

                if (journalLines.length >= 2) {
                    await JournalService.createEntry({
                        description: `REFUND POS Sale Settlement ${receiptNumber || String(sale.id).slice(-8)}`,
                        reference_type: 'pos_sale_refund',
                        reference_id: String(sale.id),
                        created_by: userId,
                        idempotency_key: `pos_sale_refund_settlement_${sale.id}`,
                        lines: journalLines
                    }, t);
                }
            }

            const safeCogs = Math.max(0, Number(totalCogs || 0));
            if (hppAcc && inventoryAcc && safeCogs > 0) {
                await JournalService.createEntry({
                    description: `REFUND POS Sale HPP ${receiptNumber || String(sale.id).slice(-8)}`,
                    reference_type: 'pos_sale_refund',
                    reference_id: String(sale.id),
                    created_by: userId,
                    idempotency_key: `pos_sale_refund_cogs_${sale.id}`,
                    lines: [
                        { account_id: inventoryAcc.id, debit: safeCogs, credit: 0 },
                        { account_id: hppAcc.id, debit: 0, credit: safeCogs }
                    ]
                }, t);
            }
        } catch (e) {
            journalErrors.push(joinError(e));
        }

        if (journalErrors.length === 0) {
            await sale.update({
                journal_status: 'posted',
                journal_posted_at: new Date(),
                journal_error: null
            }, { transaction: t });
        } else {
            const existing = String((sale as any).journal_error || '').trim();
            const merged = [
                existing ? existing : null,
                `REFUND: ${journalErrors.slice(0, 8).join('\n')}`
            ].filter(Boolean).join('\n');
            await sale.update({
                journal_status: 'failed',
                journal_posted_at: null,
                journal_error: merged
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: 'Transaksi POS berhasil direfund.', id: sale.id });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Gagal refund transaksi POS', 500);
    }
});

// Backward-compatible alias (old endpoint name)
export const voidPosSale = refundPosSale;
