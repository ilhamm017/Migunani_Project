import { Request, Response } from 'express';
import { Cart, CartItem, Product, sequelize } from '../models';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';

// Helper to get or create cart
const getOrCreateCart = async (userId: string, transaction?: any) => {
    let cart = await Cart.findOne({ where: { user_id: userId }, transaction });
    if (!cart) {
        cart = await Cart.create({ user_id: userId }, { transaction });
    }
    return cart;
};

export const getCart = asyncWrapper(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const cart = await Cart.findOne({
        where: { user_id: userId },
        include: [
            {
                model: CartItem,
                include: [{
                    model: Product,
                    attributes: ['id', 'name', 'price', 'sku', 'stock_quantity', 'image_url']
                }]
            }
        ]
    });

    if (!cart) {
        // Return empty structure instead of 404 for better FE DX
        return res.json({ id: null, items: [] });
    }

    res.json(cart);
});

export const addToCart = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id;
        const { product_id, qty } = req.body;

        if (!qty || qty <= 0) {
            await t.rollback();
            throw new CustomError('Invalid quantity', 400);
        }

        const product = await Product.findByPk(product_id, { transaction: t });
        if (!product) {
            await t.rollback();
            throw new CustomError('Product not found', 404);
        }

        const cart = await getOrCreateCart(userId, t);

        const existingItem = await CartItem.findOne({
            where: { cart_id: cart.id, product_id },
            transaction: t
        });

        if (existingItem) {
            existingItem.qty += qty;
            await existingItem.save({ transaction: t });
        } else {
            await CartItem.create({
                cart_id: cart.id,
                product_id,
                qty
            }, { transaction: t });
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

    if (qty <= 0) {
        await item.destroy();
    } else {
        await item.update({ qty });
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
