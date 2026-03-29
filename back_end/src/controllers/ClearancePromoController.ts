import { Request, Response } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { ClearancePromo, InventoryBatch, Product, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));
const toInt = (value: unknown) => Math.max(0, Math.trunc(Number(value || 0)));

const parseDate = (value: unknown): Date | null => {
    if (value instanceof Date) return value;
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date;
};

const computeRemainingQtyByCost = async (productId: string, unitCost: number, t?: any): Promise<number> => {
    const agg = await InventoryBatch.findOne({
        where: {
            product_id: productId,
            unit_cost: round4(unitCost),
            qty_on_hand: { [Op.gt]: 0 }
        },
        // Available = on_hand - reserved (cannot go below 0)
        attributes: [[sequelize.fn('SUM', sequelize.literal('GREATEST(qty_on_hand - qty_reserved, 0)')), 'qty_sum']],
        transaction: t,
        raw: true,
    }) as any;
    return Math.max(0, Math.trunc(Number(agg?.qty_sum || 0)));
};

const parseQtyLimit = (value: unknown): number | null => {
    if (value === undefined) return null;
    if (value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const v = Math.trunc(n);
    if (v <= 0) return null;
    return v;
};

const getClearancePromoUsageQtyByPromoIds = async (promoIds: string[], t?: any): Promise<Map<string, number>> => {
    const ids = (Array.isArray(promoIds) ? promoIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    const usageById = new Map<string, number>();
    if (ids.length === 0) return usageById;

    const orderRows = await sequelize.query(
        `SELECT 
            oi.clearance_promo_id AS promo_id,
            COALESCE(SUM(oi.qty), 0) AS qty_used
         FROM order_items oi
         INNER JOIN orders o ON o.id = oi.order_id
         WHERE oi.clearance_promo_id IN (:promoIds)
           AND o.status NOT IN ('canceled', 'expired')
         GROUP BY oi.clearance_promo_id`,
        {
            type: QueryTypes.SELECT,
            replacements: { promoIds: ids },
            transaction: t,
        }
    ) as any[];

    (Array.isArray(orderRows) ? orderRows : []).forEach((row: any) => {
        const id = String(row?.promo_id || '').trim();
        if (!id) return;
        usageById.set(id, toInt(row?.qty_used));
    });

    const posRows = await sequelize.query(
        `SELECT 
            psi.clearance_promo_id AS promo_id,
            COALESCE(SUM(psi.qty), 0) AS qty_used
         FROM pos_sale_items psi
         INNER JOIN pos_sales ps ON ps.id = psi.pos_sale_id
         WHERE psi.clearance_promo_id IN (:promoIds)
           AND ps.status = 'paid'
         GROUP BY psi.clearance_promo_id`,
        {
            type: QueryTypes.SELECT,
            replacements: { promoIds: ids },
            transaction: t,
        }
    ) as any[];

    (Array.isArray(posRows) ? posRows : []).forEach((row: any) => {
        const id = String(row?.promo_id || '').trim();
        if (!id) return;
        usageById.set(id, (usageById.get(id) || 0) + toInt(row?.qty_used));
    });

    return usageById;
};

const computePromoPrice = (params: {
    pricing_mode: string;
    promo_unit_price: unknown;
    discount_pct: unknown;
    normal_price: number;
}): number => {
    const mode = String(params.pricing_mode || '');
    if (mode === 'fixed_price') {
        const price = Number(params.promo_unit_price || 0);
        return Math.round(price * 100) / 100;
    }
    if (mode === 'percent_off') {
        const pct = Number(params.discount_pct || 0);
        if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return 0;
        return Math.round(params.normal_price * (1 - (pct / 100)));
    }
    return 0;
};

export const getActiveClearancePromos = asyncWrapper(async (req: Request, res: Response) => {
    const now = new Date();

    const promos = await ClearancePromo.findAll({
        where: {
            is_active: true,
            starts_at: { [Op.lte]: now },
            ends_at: { [Op.gte]: now },
        },
        include: [{
            model: Product,
            as: 'Product' as any,
            attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url', 'stock_quantity'],
            required: false,
        }],
        order: [['starts_at', 'ASC'], ['createdAt', 'DESC']],
    });

    const usageByPromoId = await getClearancePromoUsageQtyByPromoIds((promos as any[]).map((p) => String((p as any).id || '')).filter(Boolean));

    const rows = await Promise.all((promos as any[]).map(async (promo: any) => {
        const product = promo?.Product ? promo.Product : null;
        const normalPrice = Number(product?.price || 0);
        const computedPromoUnitPrice = computePromoPrice({
            pricing_mode: promo.pricing_mode,
            promo_unit_price: promo.promo_unit_price,
            discount_pct: promo.discount_pct,
            normal_price: normalPrice
        });
        const remainingQtyByCost = await computeRemainingQtyByCost(String(promo.product_id), Number(promo.target_unit_cost || 0));
        const productStockQty = product ? toInt(product?.stock_quantity) : Number.POSITIVE_INFINITY;
        const qtyLimit = promo.qty_limit === null || promo.qty_limit === undefined ? null : toInt(promo.qty_limit);
        const qtyUsed = usageByPromoId.get(String(promo.id)) || 0;
        const remainingByLimit = qtyLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, qtyLimit - qtyUsed);
        const remainingQty = Math.max(0, Math.min(remainingQtyByCost, remainingByLimit, productStockQty));

        return {
            ...promo.get({ plain: true }),
            Product: product ? product.get({ plain: true }) : null,
            remaining_qty: remainingQty,
            qty_used: qtyUsed,
            computed_promo_unit_price: computedPromoUnitPrice,
            normal_unit_price: normalPrice,
        };
    }));

    res.json({ promos: rows });
});

export const adminListClearancePromos = asyncWrapper(async (req: Request, res: Response) => {
    const includeInactive = String((req.query as any)?.include_inactive || '').trim() === 'true';

    const where: any = {};
    if (!includeInactive) {
        where.is_active = true;
    }

    const promos = await ClearancePromo.findAll({
        where,
        include: [{
            model: Product,
            as: 'Product' as any,
            attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url', 'stock_quantity'],
            required: false,
        }],
        order: [['createdAt', 'DESC']],
    });

    const usageByPromoId = await getClearancePromoUsageQtyByPromoIds((promos as any[]).map((p) => String((p as any).id || '')).filter(Boolean));

    const rows = await Promise.all((promos as any[]).map(async (promo: any) => {
        const product = promo?.Product ? promo.Product : null;
        const remainingQtyByCost = await computeRemainingQtyByCost(String(promo.product_id), Number(promo.target_unit_cost || 0));
        const productStockQty = product ? toInt(product?.stock_quantity) : Number.POSITIVE_INFINITY;
        const qtyLimit = promo.qty_limit === null || promo.qty_limit === undefined ? null : toInt(promo.qty_limit);
        const qtyUsed = usageByPromoId.get(String(promo.id)) || 0;
        const remainingByLimit = qtyLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, qtyLimit - qtyUsed);
        const remainingQty = Math.max(0, Math.min(remainingQtyByCost, remainingByLimit, productStockQty));
        return {
            ...promo.get({ plain: true }),
            remaining_qty: remainingQty,
            qty_used: qtyUsed,
        };
    }));

    res.json({ promos: rows });
});

export const adminCreateClearancePromo = asyncWrapper(async (req: Request, res: Response) => {
    const actorId = String(req.user?.id || '').trim() || null;

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const productId = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
    const pricingMode = typeof req.body?.pricing_mode === 'string' ? req.body.pricing_mode.trim() : '';
    const targetUnitCost = Number(req.body?.target_unit_cost);
    const qtyLimit = parseQtyLimit(req.body?.qty_limit);
    const startsAt = parseDate(req.body?.starts_at);
    const endsAt = parseDate(req.body?.ends_at);
    const isActive = req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    if (!name) throw new CustomError('name wajib diisi', 400);
    if (!productId) throw new CustomError('product_id wajib diisi', 400);
    if (!Number.isFinite(targetUnitCost) || targetUnitCost < 0) throw new CustomError('target_unit_cost tidak valid', 400);
    if (!qtyLimit) throw new CustomError('qty_limit wajib diisi (>= 1)', 400);
    if (!['fixed_price', 'percent_off'].includes(pricingMode)) throw new CustomError('pricing_mode tidak valid', 400);
    if (!startsAt || !endsAt) throw new CustomError('starts_at / ends_at wajib diisi', 400);
    if (startsAt.getTime() >= endsAt.getTime()) throw new CustomError('ends_at harus lebih besar dari starts_at', 400);

    const product = await Product.findByPk(productId, { attributes: ['id', 'stock_quantity'] });
    if (!product) throw new CustomError('Produk tidak ditemukan', 404);

    const remainingQtyByCost = await computeRemainingQtyByCost(String(productId), Number(targetUnitCost || 0));
    const productStockQty = toInt((product as any)?.stock_quantity);
    const maxAllocatable = Math.max(0, Math.min(remainingQtyByCost, productStockQty));
    if (qtyLimit > maxAllocatable) {
        throw new CustomError(`qty_limit melebihi stok tersedia (batch/stock: ${maxAllocatable}).`, 400);
    }

    const payload: any = {
        name,
        product_id: productId,
        target_unit_cost: round4(targetUnitCost),
        qty_limit: qtyLimit,
        pricing_mode: pricingMode,
        starts_at: startsAt,
        ends_at: endsAt,
        is_active: isActive,
        created_by: actorId,
        updated_by: actorId,
    };

    if (pricingMode === 'fixed_price') {
        const promoUnitPrice = Number(req.body?.promo_unit_price);
        if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) throw new CustomError('promo_unit_price wajib diisi (fixed_price)', 400);
        payload.promo_unit_price = Math.round(promoUnitPrice * 100) / 100;
        payload.discount_pct = null;
    } else {
        const discountPct = Number(req.body?.discount_pct);
        if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) throw new CustomError('discount_pct wajib diisi (1-99.99)', 400);
        payload.discount_pct = Math.round(discountPct * 100) / 100;
        payload.promo_unit_price = null;
    }

    const created = await ClearancePromo.create(payload);
    await created.reload({
        include: [{ model: Product, as: 'Product' as any, attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url'], required: false }],
    });

    res.status(201).json({ promo: created.get({ plain: true }) });
});

export const adminUpdateClearancePromo = asyncWrapper(async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) throw new CustomError('id tidak valid', 400);

    const promo = await ClearancePromo.findByPk(id);
    if (!promo) throw new CustomError('Promo tidak ditemukan', 404);

    const actorId = String(req.user?.id || '').trim() || null;

    const patch: any = {};
    if (typeof req.body?.name === 'string') patch.name = req.body.name.trim();
    if (typeof req.body?.product_id === 'string') patch.product_id = req.body.product_id.trim();
    if (req.body?.qty_limit !== undefined) {
        const v = parseQtyLimit(req.body.qty_limit);
        if (!v) throw new CustomError('qty_limit tidak valid (>= 1)', 400);
        patch.qty_limit = v;
    }
    if (req.body?.target_unit_cost !== undefined) {
        const v = Number(req.body.target_unit_cost);
        if (!Number.isFinite(v) || v < 0) throw new CustomError('target_unit_cost tidak valid', 400);
        patch.target_unit_cost = round4(v);
    }
    if (typeof req.body?.pricing_mode === 'string') patch.pricing_mode = req.body.pricing_mode.trim();
    if (req.body?.starts_at !== undefined) {
        const d = parseDate(req.body.starts_at);
        if (!d) throw new CustomError('starts_at tidak valid', 400);
        patch.starts_at = d;
    }
    if (req.body?.ends_at !== undefined) {
        const d = parseDate(req.body.ends_at);
        if (!d) throw new CustomError('ends_at tidak valid', 400);
        patch.ends_at = d;
    }
    if (req.body?.is_active !== undefined) patch.is_active = Boolean(req.body.is_active);

    const nextPricingMode = typeof patch.pricing_mode === 'string' ? patch.pricing_mode : String((promo as any).pricing_mode || '');
    if (!['fixed_price', 'percent_off'].includes(nextPricingMode)) throw new CustomError('pricing_mode tidak valid', 400);

    if (nextPricingMode === 'fixed_price') {
        const promoUnitPrice = req.body?.promo_unit_price !== undefined ? Number(req.body.promo_unit_price) : Number((promo as any).promo_unit_price || 0);
        if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) throw new CustomError('promo_unit_price wajib diisi (fixed_price)', 400);
        patch.promo_unit_price = Math.round(promoUnitPrice * 100) / 100;
        patch.discount_pct = null;
    } else {
        const discountPct = req.body?.discount_pct !== undefined ? Number(req.body.discount_pct) : Number((promo as any).discount_pct || 0);
        if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) throw new CustomError('discount_pct wajib diisi (1-99.99)', 400);
        patch.discount_pct = Math.round(discountPct * 100) / 100;
        patch.promo_unit_price = null;
    }

    const startsAt = patch.starts_at ? new Date(patch.starts_at) : new Date((promo as any).starts_at || 0);
    const endsAt = patch.ends_at ? new Date(patch.ends_at) : new Date((promo as any).ends_at || 0);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt.getTime() >= endsAt.getTime()) {
        throw new CustomError('starts_at/ends_at tidak valid', 400);
    }

    if (patch.product_id) {
        const product = await Product.findByPk(String(patch.product_id), { attributes: ['id'] });
        if (!product) throw new CustomError('Produk tidak ditemukan', 404);
    }

    if (patch.qty_limit !== undefined) {
        const usageMap = await getClearancePromoUsageQtyByPromoIds([id]);
        const qtyUsed = usageMap.get(id) || 0;
        if (patch.qty_limit < qtyUsed) {
            throw new CustomError(`qty_limit tidak boleh lebih kecil dari qty terpakai (${qtyUsed}).`, 400);
        }
    }

    patch.updated_by = actorId;

    await promo.update(patch);
    await promo.reload({
        include: [{ model: Product, as: 'Product' as any, attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url'], required: false }],
    });

    res.json({ promo: promo.get({ plain: true }) });
});

export const adminDeleteClearancePromo = asyncWrapper(async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id) throw new CustomError('id tidak valid', 400);

    const promo = await ClearancePromo.findByPk(id);
    if (!promo) throw new CustomError('Promo tidak ditemukan', 404);

    const usageMap = await getClearancePromoUsageQtyByPromoIds([id]);
    const qtyUsed = usageMap.get(id) || 0;
    if (qtyUsed > 0) {
        throw new CustomError(`Promo sudah digunakan (${qtyUsed}). Tidak bisa dihapus.`, 400);
    }

    await promo.destroy();
    res.json({ message: 'Promo berhasil dihapus' });
});
