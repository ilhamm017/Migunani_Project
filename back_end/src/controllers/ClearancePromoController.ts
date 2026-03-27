import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { ClearancePromo, InventoryBatch, Product, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));

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
        attributes: [[sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum']],
        transaction: t,
        raw: true,
    }) as any;
    return Math.max(0, Math.trunc(Number(agg?.qty_sum || 0)));
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
            attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url'],
            required: false,
        }],
        order: [['starts_at', 'ASC'], ['createdAt', 'DESC']],
    });

    const rows = await Promise.all((promos as any[]).map(async (promo: any) => {
        const product = promo?.Product ? promo.Product : null;
        const normalPrice = Number(product?.price || 0);
        const computedPromoUnitPrice = computePromoPrice({
            pricing_mode: promo.pricing_mode,
            promo_unit_price: promo.promo_unit_price,
            discount_pct: promo.discount_pct,
            normal_price: normalPrice
        });
        const remainingQty = await computeRemainingQtyByCost(String(promo.product_id), Number(promo.target_unit_cost || 0));

        return {
            ...promo.get({ plain: true }),
            Product: product ? product.get({ plain: true }) : null,
            remaining_qty: remainingQty,
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
            attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url'],
            required: false,
        }],
        order: [['createdAt', 'DESC']],
    });

    const rows = await Promise.all((promos as any[]).map(async (promo: any) => {
        const remainingQty = await computeRemainingQtyByCost(String(promo.product_id), Number(promo.target_unit_cost || 0));
        return {
            ...promo.get({ plain: true }),
            remaining_qty: remainingQty,
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
    const startsAt = parseDate(req.body?.starts_at);
    const endsAt = parseDate(req.body?.ends_at);
    const isActive = req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    if (!name) throw new CustomError('name wajib diisi', 400);
    if (!productId) throw new CustomError('product_id wajib diisi', 400);
    if (!Number.isFinite(targetUnitCost) || targetUnitCost < 0) throw new CustomError('target_unit_cost tidak valid', 400);
    if (!['fixed_price', 'percent_off'].includes(pricingMode)) throw new CustomError('pricing_mode tidak valid', 400);
    if (!startsAt || !endsAt) throw new CustomError('starts_at / ends_at wajib diisi', 400);
    if (startsAt.getTime() >= endsAt.getTime()) throw new CustomError('ends_at harus lebih besar dari starts_at', 400);

    const product = await Product.findByPk(productId, { attributes: ['id'] });
    if (!product) throw new CustomError('Produk tidak ditemukan', 404);

    const payload: any = {
        name,
        product_id: productId,
        target_unit_cost: round4(targetUnitCost),
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

    patch.updated_by = actorId;

    await promo.update(patch);
    await promo.reload({
        include: [{ model: Product, as: 'Product' as any, attributes: ['id', 'sku', 'name', 'unit', 'price', 'image_url'], required: false }],
    });

    res.json({ promo: promo.get({ plain: true }) });
});
