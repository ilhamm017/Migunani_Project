import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { resolveEffectiveTierPricing, normalizeShippingMethodCode, CheckoutPaymentMethod, normalizeCheckoutItems, resolveShippingMethodForCheckout, ALLOWED_PAYMENT_METHODS } from './utils';

export const checkout = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id; // Authenticated user
        const userRole = req.user!.role;
        const { items, payment_method, from_cart, customer_id, source, shipping_method_code, promo_code, shipping_address, customer_note } = req.body;
        // items: [{ product_id, qty }]
        // payment_method: 'transfer_manual' | 'cod'
        // from_cart: boolean
        // source: 'web' | 'whatsapp'
        // promo_code: string

        let targetCustomerId = userId;
        if (['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole) && customer_id) {
            targetCustomerId = customer_id;
        }

        const useCart = from_cart === true || String(from_cart || '').toLowerCase() === 'true';
        const requestedPaymentMethod = typeof payment_method === 'string'
            ? payment_method.trim().toLowerCase()
            : '';
        if (requestedPaymentMethod && !ALLOWED_PAYMENT_METHODS.includes(requestedPaymentMethod as CheckoutPaymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran tidak valid' });
        }
        const resolvedPaymentMethod: CheckoutPaymentMethod = (requestedPaymentMethod || 'transfer_manual') as CheckoutPaymentMethod;

        let finalItems = normalizeCheckoutItems(items);

        if (useCart) {
            // Cart Logic assumes targetCustomerId is the one with the cart? 
            // Usually admins won't use 'from_cart' for others unless we pass cart_id.
            // Let's assume admins only use 'items' array.
            const cart = await Cart.findOne({
                where: { user_id: targetCustomerId },
                include: [CartItem]
            });

            if (!cart || !cart.CartItems || cart.CartItems.length === 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Cart is empty' });
            }

            // Map CartItems to standard items format
            finalItems = cart.CartItems.map((ci: any) => ({
                product_id: ci.product_id,
                qty: Number(ci.qty)
            }));
        } else if (!finalItems || finalItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Cart is empty' });
        }

        if (!finalItems || finalItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Item checkout tidak valid' });
        }

        let totalAmount = 0;
        let totalDiscountAmount = 0;
        const orderItemsData = [];

        const customer = await User.findByPk(targetCustomerId, {
            attributes: ['id', 'name', 'role', 'status'],
            include: [{ model: CustomerProfile, attributes: ['tier', 'points'] }],
            transaction: t
        });
        if (!customer) {
            await t.rollback();
            return res.status(404).json({ message: 'Customer tidak ditemukan' });
        }
        if (customer.role !== 'customer') {
            await t.rollback();
            return res.status(400).json({ message: 'Order hanya bisa dibuat untuk akun customer' });
        }
        if (customer.status !== 'active') {
            await t.rollback();
            return res.status(403).json({ message: 'Akun customer sedang diblokir' });
        }
        const customerName = typeof customer?.name === 'string' && customer.name.trim()
            ? customer.name.trim()
            : 'Customer';

        const customerProfile = (customer as any)?.CustomerProfile as (CustomerProfile & { tier?: string; points?: number }) | undefined;
        const userTier = customerProfile?.tier || 'regular';

        // Validate products & Calculate Total
        // NOTE: Stock is NOT decremented here. Stock allocation happens when admin reviews.
        for (const item of finalItems) {
            const product = await Product.findByPk(item.product_id, {
                include: [{ model: Category, attributes: ['id', 'name', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'], required: false }],
                transaction: t,
            });

            if (!product) {
                await t.rollback();
                return res.status(404).json({ message: `Product ${item.product_id} not found` });
            }

            // Stock check is informational only — admin will do final allocation
            // We still create the order even if stock is low (admin decides)

            // Calculate Price (Snapshot)
            const basePrice = Number(product.price);
            const pricing = resolveEffectiveTierPricing(basePrice, String(userTier || 'regular'), product.varian_harga, (product as any).Category);
            const priceAtPurchase = pricing.finalPrice;

            const costAtPurchase = Number(product.base_price);
            const subtotal = priceAtPurchase * item.qty;
            const lineDiscount = Math.max(0, Math.round((Math.max(0, basePrice - priceAtPurchase) * item.qty) * 100) / 100);

            totalAmount += subtotal;
            totalDiscountAmount += lineDiscount;

            orderItemsData.push({
                product_id: product.id,
                qty: item.qty,
                price_at_purchase: priceAtPurchase,
                cost_at_purchase: costAtPurchase,
                pricing_snapshot: {
                    tier: String(userTier || 'regular'),
                    base_price: basePrice,
                    discount_pct: pricing.discountPct,
                    discount_source: pricing.discountSource,
                    category_id: Number((product as any).category_id || 0) || null,
                    category_name: String((product as any)?.Category?.name || '').trim() || null
                }
            });
        }

        const requestedShippingCode = normalizeShippingMethodCode(shipping_method_code);
        const selectedShippingMethod = await resolveShippingMethodForCheckout(requestedShippingCode);
        if (requestedShippingCode && !selectedShippingMethod) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pengiriman tidak valid atau tidak aktif' });
        }
        const shippingFee = Number(selectedShippingMethod?.fee || 0);
        totalAmount += shippingFee;

        // Apply promo code if present
        let promoDiscountAmount = 0;
        if (promo_code) {
            const settings = await Setting.findByPk('discount_vouchers', { transaction: t });
            const vouchers = Array.isArray(settings?.value) ? settings.value : [];
            const normalizedPromoCode = String(promo_code).trim().toUpperCase();
            const voucher = vouchers.find((v: any) => v.code === normalizedPromoCode);

            if (!voucher || !voucher.is_active) {
                await t.rollback();
                return res.status(400).json({ message: 'Kode promo tidak valid atau sudah tidak aktif' });
            }

            const now = new Date();
            if (now < new Date(voucher.starts_at) || now > new Date(voucher.expires_at)) {
                await t.rollback();
                return res.status(400).json({ message: 'Kode promo sudah kedaluwarsa atau belum bisa digunakan' });
            }

            if (voucher.usage_count >= voucher.usage_limit) {
                await t.rollback();
                return res.status(400).json({ message: 'Kuota kode promo sudah habis' });
            }

            const voucherProductId = typeof voucher.product_id === 'string' ? voucher.product_id.trim() : '';
            if (!voucherProductId) {
                await t.rollback();
                return res.status(400).json({ message: 'Kode promo tidak valid untuk produk.' });
            }

            const eligibleSubtotal = orderItemsData.reduce((sum, item: any) => {
                if (String(item.product_id) !== voucherProductId) return sum;
                return sum + (Number(item.price_at_purchase || 0) * Number(item.qty || 0));
            }, 0);

            if (eligibleSubtotal <= 0) {
                await t.rollback();
                return res.status(400).json({ message: 'Kode promo tidak berlaku untuk produk di keranjang.' });
            }

            promoDiscountAmount = Math.min(
                Math.round(eligibleSubtotal * (voucher.discount_pct / 100)),
                voucher.max_discount_rupiah || Infinity
            );

            totalAmount = Math.max(0, totalAmount - promoDiscountAmount);
            totalDiscountAmount += promoDiscountAmount;

            // Increment usage count
            voucher.usage_count += 1;
            await settings?.update({ value: vouchers }, { transaction: t });
        }

        const pointsEarned = Math.floor(Math.max(0, Number(totalAmount || 0)) / 1000);
        let customerPointsBalance = Number(customerProfile?.points || 0);

        // Create Order
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30); // 30 Days expiry

        const order = await Order.create({
            customer_id: targetCustomerId,
            customer_name: customerName,
            source: (source === 'whatsapp') ? 'whatsapp' : 'web',
            status: 'pending', // All orders start as pending — admin reviews and allocates
            payment_method: resolvedPaymentMethod,
            total_amount: totalAmount,
            discount_amount: totalDiscountAmount,
            expiry_date: expiryDate,
            stock_released: false,
            shipping_method_code: selectedShippingMethod?.code || null,
            shipping_method_name: selectedShippingMethod?.name || null,
            shipping_fee: shippingFee,
            shipping_address: typeof shipping_address === 'string' ? shipping_address.trim() : null,
            customer_note: typeof customer_note === 'string' ? customer_note.trim() : null
        }, { transaction: t });

        // Create Order Items
        for (const itemData of orderItemsData) {
            const createdItem = await OrderItem.create({
                order_id: order.id,
                ...itemData
            }, { transaction: t });

            const product = await Product.findByPk(itemData.product_id, { transaction: t });
            const available = Number(product?.stock_quantity || 0);
            const shortage = Math.max(0, Number(itemData.qty || 0) - available);
            if (shortage > 0) {
                await Backorder.create({
                    order_item_id: createdItem.id,
                    qty_pending: shortage,
                    status: 'waiting_stock',
                    notes: 'Auto created on order placement'
                }, { transaction: t });
            }
        }

        if (pointsEarned > 0) {
            if (customerProfile) {
                customerPointsBalance += pointsEarned;
                await CustomerProfile.update(
                    { points: customerPointsBalance },
                    {
                        where: { user_id: targetCustomerId },
                        transaction: t
                    }
                );
            } else {
                await CustomerProfile.create({
                    user_id: targetCustomerId,
                    tier: 'regular',
                    credit_limit: 0,
                    points: pointsEarned,
                    saved_addresses: []
                }, { transaction: t });
                customerPointsBalance = pointsEarned;
            }
        }

        await t.commit();
        emitOrderStatusChanged({
            order_id: order.id,
            from_status: null,
            to_status: String(order.status || 'pending'),
            source: String(order.source || source || 'web'),
            payment_method: resolvedPaymentMethod,
            courier_id: null,
            triggered_by_role: userRole || null,
            target_roles: ['kasir'],
        });


        // If successful and from_cart, clear the cart
        if (useCart) {
            const cart = await Cart.findOne({ where: { user_id: targetCustomerId } });
            if (cart) {
                await CartItem.destroy({ where: { cart_id: cart.id } });
            }
        }

        res.status(201).json({
            message: 'Order placed successfully',
            order_id: order.id,
            total_amount: totalAmount,
            points_earned: pointsEarned,
            customer_points_balance: customerPointsBalance,
            shipping_method_code: selectedShippingMethod?.code || null,
            shipping_method_name: selectedShippingMethod?.name || null,
            shipping_fee: shippingFee,
            status: order.status
        });

    } catch (error) {
        console.error('Checkout failed:', error);
        // t.rollback() is handled by each return or here if error matches
        // Actually, if we return inside try, we explicitly rollback. 
        // If error thrown, we rollback here.
        // We need to check if transaction is finished?
        // simple way:
        try { await t.rollback(); } catch (e) { }
        res.status(500).json({ message: 'Checkout failed', error });
    }
};
