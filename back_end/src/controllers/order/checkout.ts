import { Request, Response } from 'express';
import { ClearancePromo, InventoryBatch, Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Category, Setting } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';
import { recordOrderEvent } from '../../utils/orderEvent';
import { resolveEffectiveTierPricing, normalizeShippingMethodCode, CheckoutPaymentMethod, normalizeCheckoutItems, resolveShippingMethodForCheckout, ALLOWED_PAYMENT_METHODS } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { beginIdempotentRequest, clearIdempotentRequest, commitIdempotentRequest, getIdempotencyKey } from '../../utils/idempotency';

const round4 = (value: unknown) => Number(Number(value || 0).toFixed(4));

export const checkout = asyncWrapper(async (req: Request, res: Response) => {
    const idempotencyKey = getIdempotencyKey(req);
    const idempotencyScope = `checkout:${String(req.user?.id || '')}`;
    if (idempotencyKey) {
        const decision = await beginIdempotentRequest(idempotencyKey, idempotencyScope);
        if (decision.action === 'replay') {
            return res.status(Number(decision.statusCode || 200)).json(decision.payload);
        }
        if (decision.action === 'conflict') {
            throw new CustomError('Permintaan checkout duplikat sedang diproses', 409);
        }
    }

    const t = await sequelize.transaction();
    try {
        const userId = req.user!.id; // Authenticated user
        const userRole = req.user!.role;
        const { items, payment_method, from_cart, customer_id, source, shipping_method_code, promo_code, shipping_address, customer_note, price_override_reason } = req.body;
        // items: [{ product_id, qty }]
        // payment_method: 'transfer_manual' | 'cod'
        // from_cart: boolean
        // source: 'web' | 'whatsapp'
        // promo_code: string

        const isAdminOrderCreator = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole);
        let targetCustomerId = userId;
        if (isAdminOrderCreator && customer_id) {
            targetCustomerId = customer_id;
        }
        const canOverridePriceOnManualOrder = ['super_admin', 'kasir'].includes(userRole) && Boolean(customer_id);
        const orderLevelOverrideReason = (canOverridePriceOnManualOrder && typeof price_override_reason === 'string')
            ? String(price_override_reason).trim()
            : '';

        const useCart = from_cart === true || String(from_cart || '').toLowerCase() === 'true';
        const requestedPaymentMethod = typeof payment_method === 'string'
            ? payment_method.trim().toLowerCase()
            : '';
        let resolvedPaymentMethod: CheckoutPaymentMethod | null = null;
        if (requestedPaymentMethod) {
            if (!ALLOWED_PAYMENT_METHODS.includes(requestedPaymentMethod as CheckoutPaymentMethod)) {
                await t.rollback();
                throw new CustomError('Metode pembayaran tidak valid', 400);
            }
            resolvedPaymentMethod = requestedPaymentMethod as CheckoutPaymentMethod;
        }
        // Customer checkout from catalog/cart does not require explicit payment method selection.
        // When omitted, payment_method stays NULL and will be decided later (e.g. by driver/ops).

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
                throw new CustomError('Cart is empty', 400);
            }

            // Map CartItems to standard items format (no price override from cart)
            finalItems = cart.CartItems.map((ci: any) => ({
                product_id: ci.product_id,
                qty: Number(ci.qty)
            }));
        } else if (!finalItems || finalItems.length === 0) {
            await t.rollback();
            throw new CustomError('Cart is empty', 400);
        }

        if (!finalItems || finalItems.length === 0) {
            await t.rollback();
            throw new CustomError('Item checkout tidak valid', 400);
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
            throw new CustomError('Customer tidak ditemukan', 404);
        }
        if (customer.role !== 'customer') {
            await t.rollback();
            throw new CustomError('Order hanya bisa dibuat untuk akun customer', 400);
        }
        if (customer.status !== 'active') {
            await t.rollback();
            throw new CustomError('Akun customer sedang diblokir', 403);
        }
        const customerName = typeof customer?.name === 'string' && customer.name.trim()
            ? customer.name.trim()
            : 'Customer';

        const customerProfile = (customer as any)?.CustomerProfile as (CustomerProfile & { tier?: string; points?: number }) | undefined;
        const userTier = customerProfile?.tier || 'regular';

        // Validate products & Calculate Total
        // NOTE: Stock is NOT decremented here. Stock allocation happens when admin reviews.
        for (const item of finalItems) {
            const clearancePromoId = typeof (item as any)?.clearance_promo_id === 'string'
                ? String((item as any).clearance_promo_id).trim()
                : '';

            const product = await Product.findByPk(item.product_id, {
                include: [{ model: Category, attributes: ['id', 'name', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'], required: false }],
                transaction: t,
            });

            if (!product) {
                await t.rollback();
                throw new CustomError(`Product ${item.product_id} not found`, 404);
            }

            // Stock check is informational only — admin will do final allocation
            // We still create the order even if stock is low (admin decides)

            // Calculate Price (Snapshot)
            const basePrice = Number(product.price);
            const pricing = resolveEffectiveTierPricing(basePrice, String(userTier || 'regular'), product.varian_harga, (product as any).Category);
            const computedUnitPrice = pricing.finalPrice;

            const costAtPurchase = Number(product.base_price);
            const overrideUnitPrice = (canOverridePriceOnManualOrder && typeof (item as any)?.unit_price_override === 'number')
                ? Number((item as any).unit_price_override)
                : null;
            const itemReasonRaw = typeof (item as any)?.unit_price_override_reason === 'string'
                ? String((item as any).unit_price_override_reason).trim()
                : '';
            const effectiveReason = itemReasonRaw || orderLevelOverrideReason || null;

            let finalUnitPrice = computedUnitPrice;
            let overridePayload: any = null;
            if (clearancePromoId && overrideUnitPrice !== null) {
                await t.rollback();
                throw new CustomError('Tidak boleh mengisi unit_price_override jika memakai promo cepat habis.', 400);
            }
            if (!clearancePromoId && overrideUnitPrice !== null) {
                if (!Number.isFinite(overrideUnitPrice) || overrideUnitPrice <= 0) {
                    await t.rollback();
                    throw new CustomError('Harga deal tidak valid', 400);
                }
                // Negotiation is intended to lower price, not raise it.
                if (overrideUnitPrice > computedUnitPrice) {
                    await t.rollback();
                    throw new CustomError('Harga deal tidak boleh lebih tinggi dari harga normal', 400);
                }
                if (userRole === 'kasir' && Number.isFinite(costAtPurchase) && overrideUnitPrice < costAtPurchase) {
                    await t.rollback();
                    throw new CustomError('Kasir tidak boleh menurunkan harga di bawah modal', 400);
                }
                finalUnitPrice = overrideUnitPrice;
                overridePayload = {
                    unit_price: overrideUnitPrice,
                    reason: effectiveReason,
                    actor_user_id: String(req.user?.id || ''),
                    actor_role: String(req.user?.role || ''),
                    at: new Date().toISOString()
                };
            }

            if (!clearancePromoId) {
                const subtotal = finalUnitPrice * item.qty;
                const lineDiscount = Math.max(0, Math.round((Math.max(0, basePrice - finalUnitPrice) * item.qty) * 100) / 100);

                totalAmount += subtotal;
                totalDiscountAmount += lineDiscount;

                orderItemsData.push({
                    product_id: product.id,
                    qty: item.qty,
                    price_at_purchase: finalUnitPrice,
                    cost_at_purchase: costAtPurchase,
                    pricing_snapshot: {
                        tier: String(userTier || 'regular'),
                        base_price: basePrice,
                        discount_pct: pricing.discountPct,
                        discount_source: pricing.discountSource,
                        category_id: Number((product as any).category_id || 0) || null,
                        category_name: String((product as any)?.Category?.name || '').trim() || null,
                        computed_unit_price: computedUnitPrice,
                        final_unit_price: finalUnitPrice,
                        override: overridePayload,
                        override_history: overridePayload ? [overridePayload] : []
                    }
                });
                continue;
            }

            const promo = await ClearancePromo.findByPk(clearancePromoId, { transaction: t, lock: t.LOCK.SHARE });
            if (!promo) {
                await t.rollback();
                throw new CustomError('Promo cepat habis tidak ditemukan.', 404);
            }
            if (String((promo as any).product_id) !== String(product.id)) {
                await t.rollback();
                throw new CustomError('Promo cepat habis tidak cocok untuk produk ini.', 400);
            }
            if (!(promo as any).is_active) {
                await t.rollback();
                throw new CustomError('Promo cepat habis sedang non-aktif.', 400);
            }
            const now = Date.now();
            const startsAt = new Date((promo as any).starts_at || 0).getTime();
            const endsAt = new Date((promo as any).ends_at || 0).getTime();
            if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || now < startsAt || now > endsAt) {
                await t.rollback();
                throw new CustomError('Promo cepat habis belum berlaku atau sudah berakhir.', 400);
            }

            const pricingMode = String((promo as any).pricing_mode || '');
            let promoUnitPrice = 0;
            if (pricingMode === 'fixed_price') {
                promoUnitPrice = Math.round(Number((promo as any).promo_unit_price || 0) * 100) / 100;
                if (!Number.isFinite(promoUnitPrice) || promoUnitPrice <= 0) {
                    await t.rollback();
                    throw new CustomError('promo_unit_price tidak valid untuk promo cepat habis.', 400);
                }
            } else if (pricingMode === 'percent_off') {
                const pct = Number((promo as any).discount_pct || 0);
                if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
                    await t.rollback();
                    throw new CustomError('discount_pct tidak valid untuk promo cepat habis.', 400);
                }
                promoUnitPrice = Math.round(computedUnitPrice * (1 - (pct / 100)));
                promoUnitPrice = Math.round(promoUnitPrice * 100) / 100;
            } else {
                await t.rollback();
                throw new CustomError('pricing_mode tidak valid untuk promo cepat habis.', 400);
            }

            const targetUnitCost = round4((promo as any).target_unit_cost);
            const remainingAgg = await InventoryBatch.findOne({
                where: {
                    product_id: String(product.id),
                    unit_cost: targetUnitCost,
                    qty_on_hand: { [Op.gt]: 0 }
                },
                attributes: [[sequelize.fn('SUM', sequelize.col('qty_on_hand')), 'qty_sum']],
                transaction: t,
                raw: true,
            }) as any;
            const remainingQty = Math.max(0, Math.trunc(Number(remainingAgg?.qty_sum || 0)));
            const promoQty = Math.max(0, Math.min(item.qty, remainingQty));
            const normalQty = Math.max(0, item.qty - promoQty);

            if (promoQty > 0) {
                const subtotal = promoUnitPrice * promoQty;
                const lineDiscount = Math.max(0, Math.round((Math.max(0, basePrice - promoUnitPrice) * promoQty) * 100) / 100);

                totalAmount += subtotal;
                totalDiscountAmount += lineDiscount;

                orderItemsData.push({
                    product_id: product.id,
                    clearance_promo_id: String((promo as any).id),
                    qty: promoQty,
                    price_at_purchase: promoUnitPrice,
                    cost_at_purchase: costAtPurchase,
                    pricing_snapshot: {
                        tier: String(userTier || 'regular'),
                        base_price: basePrice,
                        discount_pct: pricing.discountPct,
                        discount_source: pricing.discountSource,
                        category_id: Number((product as any).category_id || 0) || null,
                        category_name: String((product as any)?.Category?.name || '').trim() || null,
                        computed_unit_price: computedUnitPrice,
                        final_unit_price: promoUnitPrice,
                        override: null,
                        override_history: [],
                        clearance_promo: {
                            id: String((promo as any).id),
                            pricing_mode: pricingMode,
                            target_unit_cost: targetUnitCost,
                            promo_unit_price: pricingMode === 'fixed_price' ? promoUnitPrice : null,
                            discount_pct: pricingMode === 'percent_off' ? Number((promo as any).discount_pct || 0) : null,
                        }
                    }
                });
            }

            if (normalQty > 0) {
                const subtotal = finalUnitPrice * normalQty;
                const lineDiscount = Math.max(0, Math.round((Math.max(0, basePrice - finalUnitPrice) * normalQty) * 100) / 100);

                totalAmount += subtotal;
                totalDiscountAmount += lineDiscount;

                orderItemsData.push({
                    product_id: product.id,
                    qty: normalQty,
                    price_at_purchase: finalUnitPrice,
                    cost_at_purchase: costAtPurchase,
                    pricing_snapshot: {
                        tier: String(userTier || 'regular'),
                        base_price: basePrice,
                        discount_pct: pricing.discountPct,
                        discount_source: pricing.discountSource,
                        category_id: Number((product as any).category_id || 0) || null,
                        category_name: String((product as any)?.Category?.name || '').trim() || null,
                        computed_unit_price: computedUnitPrice,
                        final_unit_price: finalUnitPrice,
                        override: overridePayload,
                        override_history: overridePayload ? [overridePayload] : []
                    }
                });
            }
        }

        const requestedShippingCode = normalizeShippingMethodCode(shipping_method_code);
        const selectedShippingMethod = await resolveShippingMethodForCheckout(requestedShippingCode);
        if (requestedShippingCode && !selectedShippingMethod) {
            await t.rollback();
            throw new CustomError('Metode pengiriman tidak valid atau tidak aktif', 400);
        }
        const shippingFee = Number(selectedShippingMethod?.fee || 0);
        totalAmount += shippingFee;

        // Apply promo code if present
        let promoDiscountAmount = 0;
        if (promo_code) {
            const settings = await Setting.findByPk('discount_vouchers', {
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            const vouchers = Array.isArray(settings?.value) ? settings.value : [];
            const normalizedPromoCode = String(promo_code).trim().toUpperCase();
            const voucher = vouchers.find((v: any) => v.code === normalizedPromoCode);

            if (!voucher || !voucher.is_active) {
                await t.rollback();
                throw new CustomError('Kode promo tidak valid atau sudah tidak aktif', 400);
            }

            const now = new Date();
            if (now < new Date(voucher.starts_at) || now > new Date(voucher.expires_at)) {
                await t.rollback();
                throw new CustomError('Kode promo sudah kedaluwarsa atau belum bisa digunakan', 400);
            }

            if (voucher.usage_count >= voucher.usage_limit) {
                await t.rollback();
                throw new CustomError('Kuota kode promo sudah habis', 400);
            }

            const voucherProductId = typeof voucher.product_id === 'string' ? voucher.product_id.trim() : '';
            if (!voucherProductId) {
                await t.rollback();
                throw new CustomError('Kode promo tidak valid untuk produk.', 400);
            }

            const eligibleSubtotal = orderItemsData.reduce((sum, item: any) => {
                if (String(item.product_id) !== voucherProductId) return sum;
                return sum + (Number(item.price_at_purchase || 0) * Number(item.qty || 0));
            }, 0);

            if (eligibleSubtotal <= 0) {
                await t.rollback();
                throw new CustomError('Kode promo tidak berlaku untuk produk di keranjang.', 400);
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

        let finalCustomerNote = typeof customer_note === 'string' ? customer_note.trim() : null;
        if (userRole !== 'customer') {
            const userName = (req.user as any)?.name || userId;
            const adminNote = `[Dibuat oleh ${userRole}: ${userName}]`;
            finalCustomerNote = finalCustomerNote ? `${adminNote} ${finalCustomerNote}` : adminNote;
        }

	        let order: any;
	        try {
	            order = await Order.create({
	                customer_id: targetCustomerId,
	                customer_name: customerName,
	                source: (source === 'whatsapp') ? 'whatsapp' : 'web',
	                status: 'pending', // All orders start as pending — admin reviews and allocates
	                payment_method: resolvedPaymentMethod,
	                total_amount: totalAmount,
	                discount_amount: totalDiscountAmount,
	                pricing_override_note: orderLevelOverrideReason || null,
	                expiry_date: expiryDate,
	                stock_released: false,
	                shipping_method_code: selectedShippingMethod?.code || null,
	                shipping_method_name: selectedShippingMethod?.name || null,
	                shipping_fee: shippingFee,
	                shipping_address: typeof shipping_address === 'string' ? shipping_address.trim() : null,
	                customer_note: finalCustomerNote
	            }, { transaction: t });
	        } catch (error: any) {
	            const message = String(error?.parent?.sqlMessage || error?.original?.sqlMessage || error?.message || '');
	            const code = error?.parent?.code || error?.original?.code || error?.code;
	            if (code === 'ER_BAD_FIELD_ERROR' && message.includes('pricing_override_note')) {
	                await t.rollback();
	                throw new CustomError(
	                    'Database belum dimigrasi untuk fitur catatan nego. Jalankan SQL: back_end/sql/20260326_add_orders_pricing_override_note.sql',
	                    500
	                );
	            }
	            throw error;
	        }
        await recordOrderEvent({
            transaction: t,
            order_id: String(order.id),
            event_type: 'order_status_changed',
            actor_user_id: String(req.user?.id || ''),
            actor_role: String(req.user?.role || ''),
            payload: {
                before: { status: null },
                after: { status: 'pending' },
                delta: { status_changed: true }
            }
        });

        // Create Order Items
        for (const itemData of orderItemsData) {
            await OrderItem.create({
                order_id: order.id,
                ordered_qty_original: Number(itemData.qty || 0),
                qty_canceled_backorder: 0,
                qty_canceled_manual: 0,
                ...itemData
            }, { transaction: t });
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

        await emitOrderStatusChanged({
            order_id: order.id,
            from_status: null,
            to_status: String(order.status || 'pending'),
            source: String(order.source || source || 'web'),
            payment_method: resolvedPaymentMethod ?? null,
            courier_id: null,
            triggered_by_role: userRole || null,
            target_roles: ['kasir'],
        }, {
            transaction: t,
            requestContext: 'checkout_order_status_changed'
        });

        await t.commit();


        // If successful and from_cart, clear the cart
        if (useCart) {
            const cart = await Cart.findOne({ where: { user_id: targetCustomerId } });
            if (cart) {
                await CartItem.destroy({ where: { cart_id: cart.id } });
            }
        }

        const responsePayload = {
            message: 'Order placed successfully',
            order_id: order.id,
            total_amount: totalAmount,
            points_earned: pointsEarned,
            customer_points_balance: customerPointsBalance,
            shipping_method_code: selectedShippingMethod?.code || null,
            shipping_method_name: selectedShippingMethod?.name || null,
            shipping_fee: shippingFee,
            status: order.status
        };
        if (idempotencyKey) {
            await commitIdempotentRequest(idempotencyKey, idempotencyScope, 201, responsePayload);
        }
        res.status(201).json(responsePayload);

    } catch (error) {
        try { await t.rollback(); } catch (e) { }
        if (idempotencyKey) {
            await clearIdempotentRequest(idempotencyKey, idempotencyScope);
        }
        throw error;
    }
});
