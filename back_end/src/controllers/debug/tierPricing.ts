import { Request, Response } from 'express';
import { Category, CustomerProfile, Product, User } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { debugResolveEffectiveTierPricing } from '../order/utils';

export const getTierPricingDebug = asyncWrapper(async (req: Request, res: Response) => {
    const customerId = typeof req.query?.customer_id === 'string' ? req.query.customer_id.trim() : '';
    const productId = typeof req.query?.product_id === 'string' ? req.query.product_id.trim() : '';

    if (!customerId) throw new CustomError('customer_id wajib diisi', 400);
    if (!productId) throw new CustomError('product_id wajib diisi', 400);

    const customer = await User.findOne({
        where: { id: customerId, role: 'customer' },
        attributes: ['id', 'name', 'email', 'whatsapp_number', 'role', 'status'],
        include: [{ model: CustomerProfile, attributes: ['tier', 'points'], required: false }]
    });
    if (!customer) throw new CustomError('Customer tidak ditemukan', 404);

    const product = await Product.findOne({
        where: { id: productId },
        attributes: ['id', 'sku', 'name', 'price', 'varian_harga', 'category_id'],
        include: [{ model: Category, attributes: ['id', 'name', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'], required: false }]
    });
    if (!product) throw new CustomError('Produk tidak ditemukan', 404);

    const customerTier = String((customer as any)?.CustomerProfile?.tier || 'regular').trim().toLowerCase() || 'regular';
    const basePrice = Number((product as any)?.price || 0);

    const debug = debugResolveEffectiveTierPricing(
        basePrice,
        customerTier,
        (product as any)?.varian_harga,
        (product as any)?.Category
    );

    res.json({
        request_user: req.user || null,
        customer: customer.get({ plain: true }),
        product: product.get({ plain: true }),
        debug,
    });
});

