import { Request, Response } from 'express';
import { Cart, CartItem, Product, sequelize } from '../models';

// Helper to get or create cart
const getOrCreateCart = async (userId: string, transaction?: any) => {
    let cart = await Cart.findOne({ where: { user_id: userId }, transaction });
    if (!cart) {
        cart = await Cart.create({ user_id: userId }, { transaction });
    }
    return cart;
};

export const getCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const cart = await Cart.findOne({
            where: { user_id: userId },
            include: [
                {
                    model: CartItem,
                    include: [{
                        model: Product,
                        attributes: ['id', 'name', 'price', 'sku', 'stock_quantity', 'branch_id'] // Assuming products are universal or branch specific logic handles elsewhere
                    }]
                }
            ]
        });

        if (!cart) {
            // Return empty structure instead of 404 for better FE DX
            return res.json({ id: null, items: [] });
        }

        res.json(cart);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching cart', error });
    }
};

export const addToCart = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id;
        const { product_id, qty } = req.body;

        if (!qty || qty <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Invalid quantity' });
        }

        const product = await Product.findByPk(product_id, { transaction: t });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check stock availability (optional here, definitely at checkout)
        if (product.stock_quantity < qty) {
            await t.rollback();
            return res.status(400).json({ message: 'Insufficient stock' });
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
        await t.rollback();
        res.status(500).json({ message: 'Error adding to cart', error });
    }
};

export const updateCartItem = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const { id } = req.params; // CartItem ID
        const { qty } = req.body;

        const item = await CartItem.findByPk(String(id), { include: [Cart] });

        // Verify ownership
        if (!item || (item as any).Cart.user_id !== userId) {
            return res.status(404).json({ message: 'Item not found' });
        }

        if (qty <= 0) {
            await item.destroy();
        } else {
            // Check stock again?
            const product = await Product.findByPk(item.product_id);
            if (product && product.stock_quantity < qty) {
                return res.status(400).json({ message: 'Insufficient stock' });
            }

            await item.update({ qty });
        }

        res.json({ message: 'Cart updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating cart', error });
    }
};

export const removeCartItem = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user!.id;

        const item = await CartItem.findByPk(String(id), { include: [Cart] });
        if (!item || (item as any).Cart.user_id !== userId) {
            return res.status(404).json({ message: 'Item not found' });
        }

        await item.destroy();
        res.json({ message: 'Item removed' });
    } catch (error) {
        res.status(500).json({ message: 'Error removing item', error });
    }
};

export const clearCart = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const cart = await Cart.findOne({ where: { user_id: userId } });

        if (cart) {
            await CartItem.destroy({ where: { cart_id: cart.id } });
        }

        res.json({ message: 'Cart cleared' });
    } catch (error) {
        res.status(500).json({ message: 'Error clearing cart', error });
    }
};
