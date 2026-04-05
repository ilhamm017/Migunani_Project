import { Request, Response } from 'express';
import { UniqueConstraintError } from 'sequelize';
import { Cart, CartItem, Category, CustomerProfile, Product, User, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { resolveEffectiveTierPricing } from './order/utils';

const parsePositiveInt = (value: unknown): number | null => {
    const n = typeof value === 'string' ? Number(value) : (value as any);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    if (n <= 0) return null;
    return n;
};

// Helper to get or create cart
const getOrCreateCart = async (userId: string, transaction?: any) => {
    try {
        const [cart] = await Cart.findOrCreate({
            where: { user_id: userId },
            defaults: { user_id: userId },
            transaction,
        });
        return cart;
    } catch (error) {
        // With unique index on carts.user_id, concurrent create can throw; retry by reading the winner row.
        if (error instanceof UniqueConstraintError) {
            const cart = await Cart.findOne({ where: { user_id: userId }, transaction });
            if (cart) return cart;
        }
        throw error;
    }
};

export const getCart = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const customer = await User.findByPk(userId, {
        attributes: ['id'],
        include: [{ model: CustomerProfile, attributes: ['tier'], required: false }],
    });
    const userTier = String((customer as any)?.CustomerProfile?.tier || 'regular');

    const cart = await Cart.findOne({
        where: { user_id: userId },
        include: [
            {
                model: CartItem,
                include: [{
                    model: Product,
                    attributes: ['id', 'name', 'price', 'sku', 'stock_quantity', 'image_url', 'varian_harga', 'category_id'],
                    include: [{
                        model: Category,
                        attributes: ['id', 'name', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'],
                        required: false,
                    }],
                }]
            }
        ]
    });

    if (!cart) {
        // Return empty structure instead of 404 for better FE DX
        return res.json({ id: null, items: [] });
    }

    const payload = typeof (cart as any)?.toJSON === 'function'
        ? (cart as any).toJSON()
        : cart;

    const rawItems = Array.isArray(payload?.CartItems) ? payload.CartItems : [];
    for (const item of rawItems) {
        const product = item?.Product;
        if (!product) continue;

        const basePrice = Number(product.price || 0);
        const pricing = resolveEffectiveTierPricing(basePrice, userTier, product.varian_harga, product.Category);
        product.effective_tier = String(userTier || 'regular');
        product.effective_price = pricing.finalPrice;
        product.effective_discount_pct = pricing.discountPct;
        product.effective_discount_source = pricing.discountSource;

        if ('varian_harga' in product) delete product.varian_harga;
        if (product.Category && typeof product.Category === 'object') {
            delete product.Category.discount_regular_pct;
            delete product.Category.discount_gold_pct;
            delete product.Category.discount_premium_pct;
        }
    }

    res.json(payload);
});

export const addToCart = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id;
        const { product_id, qty } = req.body;

        const qtyInt = parsePositiveInt(qty);
        if (!qtyInt) {
            await t.rollback();
            throw new CustomError('Invalid quantity', 400);
        }

        const product = await Product.findByPk(product_id, { transaction: t });
        if (!product) {
            await t.rollback();
            throw new CustomError('Product not found', 404);
        }

        const cart = await getOrCreateCart(userId, t);

        try {
            const [item, created] = await CartItem.findOrCreate({
                where: { cart_id: cart.id, product_id },
                defaults: { cart_id: cart.id, product_id, qty: qtyInt },
                transaction: t,
            });

            if (!created) {
                item.qty += qtyInt;
                await item.save({ transaction: t });
            }
        } catch (error) {
            // With unique index on cart_items(cart_id, product_id), concurrent insert can throw; retry by reading then updating.
            if (error instanceof UniqueConstraintError) {
                const existingItem = await CartItem.findOne({
                    where: { cart_id: cart.id, product_id },
                    transaction: t
                });
                if (!existingItem) throw error;
                existingItem.qty += qtyInt;
                await existingItem.save({ transaction: t });
            } else {
                throw error;
            }
        }

        await t.commit();
        res.json({ message: 'Item added to cart' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

export const updateCartItem = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { id } = req.params; // CartItem ID
    const { qty } = req.body;

    const item = await CartItem.findByPk(String(id), { include: [Cart] });

    // Verify ownership
    const ownerUserId = String((item as any)?.Cart?.user_id || '');
    if (!item || !ownerUserId || ownerUserId !== userId) {
        throw new CustomError('Item not found', 404);
    }

    if (qty === 0 || qty === '0') {
        await item.destroy();
        return res.json({ message: 'Cart updated' });
    }

    const qtyInt = parsePositiveInt(qty);
    if (!qtyInt) {
        throw new CustomError('Invalid quantity', 400);
    }

    if (qtyInt <= 0) {
        await item.destroy();
    } else {
        await item.update({ qty: qtyInt });
    }

    res.json({ message: 'Cart updated' });
});

export const removeCartItem = asyncWrapper(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.user!.id;

    const item = await CartItem.findByPk(String(id), { include: [Cart] });
    const ownerUserId = String((item as any)?.Cart?.user_id || '');
    if (!item || !ownerUserId || ownerUserId !== userId) {
        throw new CustomError('Item not found', 404);
    }

    await item.destroy();
    res.json({ message: 'Item removed' });
});

export const clearCart = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const cart = await Cart.findOne({ where: { user_id: userId } });

    if (cart) {
        await CartItem.destroy({ where: { cart_id: cart.id } });
    }

    res.json({ message: 'Cart cleared' });
});
