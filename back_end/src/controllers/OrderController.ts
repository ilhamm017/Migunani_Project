import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting } from '../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from './ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../services/whatsappClient';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../utils/invoiceLookup';


// --- Customer Endpoints ---
const DELIVERY_EMPLOYEE_ROLES = ['driver'] as const;
const ORDER_STATUS_OPTIONS = ['pending', 'waiting_invoice', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'hold', 'waiting_admin_verification'] as const;
const ISSUE_SLA_HOURS = 24;
const ALLOWED_PAYMENT_METHODS = ['transfer_manual', 'cod', 'cash_store'] as const;
type CheckoutPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];
type NormalizedCheckoutItem = { product_id: string; qty: number };
type CheckoutShippingMethod = { code: string; name: string; fee: number };

const GENERIC_CUSTOMER_NAMES = new Set([
    'customer',
    'super_admin',
    'admin_gudang',
    'admin_finance',
    'driver'
]);

const isGenericCustomerName = (value: unknown): boolean => {
    if (typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    return GENERIC_CUSTOMER_NAMES.has(normalized);
};

const resolveCustomerName = (orderLike: any): string => {
    const rawName = typeof orderLike?.customer_name === 'string' ? orderLike.customer_name.trim() : '';
    if (!isGenericCustomerName(rawName)) return rawName;

    const relatedName = typeof orderLike?.Customer?.name === 'string'
        ? orderLike.Customer.name.trim()
        : '';
    if (relatedName) return relatedName;

    return rawName || 'Customer';
};

const resolveEmployeeDisplayName = (userLike: any): string => {
    const rawName = typeof userLike?.name === 'string' ? userLike.name.trim() : '';
    if (!isGenericCustomerName(rawName)) return rawName;

    const email = typeof userLike?.email === 'string' ? userLike.email.trim() : '';
    if (email) return email;

    const wa = typeof userLike?.whatsapp_number === 'string' ? userLike.whatsapp_number.trim() : '';
    if (wa) return wa;

    const role = typeof userLike?.role === 'string' ? userLike.role.trim() : '';
    if (role) return role;

    return 'Karyawan';
};

const getActiveIssue = (orderLike: any) => {
    const issues = Array.isArray(orderLike?.Issues) ? orderLike.Issues : [];
    const openIssue = issues.find((issue: any) => issue?.status === 'open');
    if (!openIssue) return null;

    // Ignore internal shortages unless order is explicitly on HOLD.
    // This distinguishes "Allocation Shortfalls" from "Real Problems" (Missing Items/Complaints).
    if (openIssue.issue_type === 'shortage' && orderLike.status !== 'hold') {
        return null;
    }

    return openIssue;
};

const withOrderTrackingFields = (orderLike: any) => {
    const activeIssue = getActiveIssue(orderLike);
    const dueAt = activeIssue?.due_at ? new Date(activeIssue.due_at) : null;
    const isOverdue = !!(dueAt && dueAt.getTime() < Date.now());

    const reporterName = activeIssue?.IssueCreator
        ? resolveEmployeeDisplayName(activeIssue.IssueCreator)
        : null;

    let courierDisplayName = orderLike?.Courier ? resolveEmployeeDisplayName(orderLike.Courier) : null;
    if (!courierDisplayName && reporterName) {
        courierDisplayName = reporterName;
    }

    return {
        ...orderLike,
        customer_name: resolveCustomerName(orderLike),
        courier_display_name: courierDisplayName,
        active_issue: activeIssue
            ? {
                id: activeIssue.id,
                issue_type: activeIssue.issue_type,
                status: activeIssue.status,
                note: activeIssue.note,
                evidence_url: activeIssue.evidence_url || null,
                resolution_note: activeIssue.resolution_note || null,
                due_at: activeIssue.due_at,
                resolved_at: activeIssue.resolved_at,
                reporter_name: reporterName,
            }
            : null,
        issue_overdue: isOverdue,
    };
};


const normalizeIssueNote = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
            return {};
        } catch {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return {};
};

const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
};

const normalizeCheckoutItems = (value: unknown): NormalizedCheckoutItem[] | null => {
    if (!Array.isArray(value)) return null;
    const normalized: NormalizedCheckoutItem[] = [];

    for (const rawItem of value) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return null;
        const item = rawItem as Record<string, unknown>;
        const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
        const qty = Number(item.qty);

        if (!productId) return null;
        if (!Number.isInteger(qty) || qty <= 0) return null;

        normalized.push({
            product_id: productId,
            qty
        });
    }

    return normalized;
};


const normalizeShippingMethodCode = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
};

const FALLBACK_SHIPPING_METHODS: Record<string, CheckoutShippingMethod> = {
    kurir_reguler: { code: 'kurir_reguler', name: 'Kurir Reguler', fee: 12000 },
    same_day: { code: 'same_day', name: 'Same Day', fee: 25000 },
    pickup: { code: 'pickup', name: 'Ambil di Toko', fee: 0 }
};

const resolveShippingMethodForCheckout = async (codeRaw: unknown): Promise<CheckoutShippingMethod | null> => {
    const code = normalizeShippingMethodCode(codeRaw);
    if (!code) return null;

    try {
        const configured = await resolveShippingMethodByCode(code);
        if (configured) {
            return {
                code: String(configured.code),
                name: String(configured.name || configured.code),
                fee: Math.max(0, Number(configured.fee || 0))
            };
        }
    } catch {
        // Fallback handles cases where settings storage isn't ready yet.
    }

    return FALLBACK_SHIPPING_METHODS[code] || null;
};




const resolveTierPriceFromVariant = (basePrice: number, tier: string, variantRaw: unknown): number => {
    if (tier === 'regular') return basePrice;

    const source = toObjectOrEmpty(variantRaw);
    const prices = toObjectOrEmpty(source.prices);
    const discounts = toObjectOrEmpty(source.discounts_pct);
    const aliases = tier === 'platinum' ? ['premium'] : [];

    const directCandidates: unknown[] = [
        source[tier],
        prices[tier],
        toObjectOrEmpty(source[tier]).price
    ];

    for (const alias of aliases) {
        directCandidates.push(source[alias], prices[alias], toObjectOrEmpty(source[alias]).price);
    }

    for (const candidate of directCandidates) {
        const direct = toFiniteNumber(candidate);
        if (direct !== null) return Math.max(0, direct);
    }

    const discountCandidates: unknown[] = [
        discounts[tier],
        toObjectOrEmpty(source[tier]).discount_pct,
        source[`${tier}_discount_pct`]
    ];
    for (const alias of aliases) {
        discountCandidates.push(discounts[alias], toObjectOrEmpty(source[alias]).discount_pct, source[`${alias}_discount_pct`]);
    }

    for (const discountRaw of discountCandidates) {
        const discountPct = toFiniteNumber(discountRaw);
        if (discountPct === null) continue;
        if (discountPct < 0 || discountPct > 100) continue;
        return Math.max(0, Math.round((basePrice * (1 - discountPct / 100)) * 100) / 100);
    }

    return basePrice;
};

const resolveCategoryDiscountPct = (categoryRaw: unknown, tier: string): number | null => {
    const category = toObjectOrEmpty(categoryRaw);
    const key = tier === 'platinum' ? 'discount_premium_pct' : `discount_${tier}_pct`;
    const rawValue = category[key];
    const parsed = toFiniteNumber(rawValue);
    if (parsed === null) return null;
    if (parsed < 0 || parsed > 100) return null;
    return parsed;
};

const resolveEffectiveTierPricing = (
    basePrice: number,
    tierRaw: string,
    variantRaw: unknown,
    categoryRaw: unknown
): { finalPrice: number; discountPct: number; discountSource: 'category' | 'tier_fallback' | 'none' } => {
    const tier = String(tierRaw || 'regular').toLowerCase();
    const categoryDiscountPct = resolveCategoryDiscountPct(categoryRaw, tier);
    if (categoryDiscountPct !== null) {
        const finalPrice = Math.max(0, Math.round((basePrice * (1 - categoryDiscountPct / 100)) * 100) / 100);
        return { finalPrice, discountPct: categoryDiscountPct, discountSource: 'category' };
    }

    if (tier === 'regular') {
        return { finalPrice: basePrice, discountPct: 0, discountSource: 'none' };
    }

    const tierFallbackPrice = resolveTierPriceFromVariant(basePrice, tier, variantRaw);
    const normalizedPrice = Math.max(0, tierFallbackPrice);
    const discountPct = basePrice <= 0
        ? 0
        : Math.min(100, Math.max(0, Math.round((((basePrice - normalizedPrice) / basePrice) * 100) * 100) / 100));
    return { finalPrice: normalizedPrice, discountPct, discountSource: 'tier_fallback' };
};

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

export const getMyOrders = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        const { page = 1, limit = 10, status } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = { customer_id: userId };
        if (status) {
            const statusStr = String(status);
            if (statusStr === 'ready_to_ship') {
                whereClause.status = { [Op.in]: ['ready_to_ship', 'waiting_payment'] };
            } else {
                whereClause.status = statusStr;
            }
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                { model: Retur, attributes: ['id', 'status'] },
                { model: OrderItem, attributes: ['qty'] },
                { model: OrderAllocation, as: 'Allocations', attributes: ['allocated_qty', 'status'] }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['createdAt', 'DESC']]
        });

        const plainOrders = orders.rows.map((row) => {
            const plain = row.get({ plain: true }) as any;
            const total_qty = (plain.OrderItems || []).reduce((sum: number, item: any) => sum + Number(item.qty || 0), 0);
            const status = String(plain.status || '').toLowerCase();
            const deliveredLikeStatus = ['shipped', 'delivered', 'completed'].includes(status);
            const allocated_qty = (plain.Allocations || []).reduce(
                (sum: number, alloc: any) => sum + Number(alloc.allocated_qty || 0),
                0
            );
            const shipped_qty = deliveredLikeStatus
                ? Math.min(total_qty, allocated_qty > 0 ? allocated_qty : total_qty)
                : 0;
            const indent_qty = Math.max(0, total_qty - shipped_qty);

            return {
                ...plain,
                total_qty,
                shipped_qty,
                indent_qty
            };
        });

        const ordersWithInvoices = await attachInvoicesToOrders(plainOrders);

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: ordersWithInvoices
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getOrderDetails = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const orderId = String(id);
        const userId = req.user!.id;
        const userRole = req.user!.role;

        const whereClause: any = { id: orderId };

        // Customers can only see their own orders
        if (userRole === 'customer') {
            whereClause.customer_id = userId;
        }

        const productAttributes = userRole === 'customer'
            ? ['name', 'sku', 'unit']
            : ['name', 'sku', 'unit', 'stock_quantity', 'allocated_quantity'];

        const order = await Order.findOne({
            where: whereClause,
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number', 'email'] },
                { model: User, as: 'Courier', attributes: ['id', 'name', 'role', 'whatsapp_number'] },
                { model: OrderIssue, as: 'Issues', where: { status: 'open' }, required: false },
                { model: OrderItem, include: [{ model: Product, attributes: productAttributes }] },
                { model: OrderAllocation, as: 'Allocations' },
                { model: Order, as: 'Children' },
                { model: Retur }
            ]
        });

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const plainOrder = order.get({ plain: true }) as any;
        const [orderWithInvoices] = await attachInvoicesToOrders([plainOrder]);
        res.json(withOrderTrackingFields(orderWithInvoices));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order details', error });
    }
};

export const uploadPaymentProof = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const orderId = String(id);
        const userId = req.user!.id;
        const file = req.file;

        if (!file) {
            await t.rollback();
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const order = await Order.findOne({
            where: { id: orderId, customer_id: userId },
            include: [{ model: User, as: 'Customer', attributes: ['id', 'name', 'whatsapp_number'] }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }
        const prevStatus = String(order.status || '');

        const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status === 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Pesanan sudah dibayar.' });
        }

        if (invoice.payment_proof_url) {
            await t.rollback();
            return res.status(400).json({ message: 'Bukti transfer sudah diunggah dan sedang dalam verifikasi.' });
        }

        // In real app, upload to S3/Cloudinary and get URL. 
        // Here we store the local path or filename.
        await invoice.update({
            payment_proof_url: file.path,
            // Keep unpaid until admin_finance verifies transfer.
            payment_status: 'unpaid',
            verified_by: null,
            verified_at: null,
        }, { transaction: t });

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (relatedOrderIds.length === 0) {
            relatedOrderIds.push(String(order.id));
        }

        await Order.update(
            { status: 'waiting_admin_verification' },
            { where: { id: { [Op.in]: relatedOrderIds } }, transaction: t }
        );
        // After upload, status becomes waiting_admin_verification until finance approves.

        await t.commit();
        if (prevStatus !== 'waiting_admin_verification') {
            emitOrderStatusChanged({
                order_id: String(order.id),
                from_status: prevStatus || null,
                to_status: 'waiting_admin_verification',
                source: String(order.source || ''),
                payment_method: String(invoice.payment_method || ''),
                courier_id: String(order.courier_id || ''),
                triggered_by_role: String(req.user?.role || 'customer'),
                target_roles: ['admin_finance', 'customer'],
            });
        } else {
            emitAdminRefreshBadges();
        }


        // --- ASYNC NOTIFICATIONS (POST-COMMIT) ---

        // --- ASYNC NOTIFICATIONS (POST-COMMIT) ---
        // Separate try-catch to ensure request succeeds even if notif fails
        (async () => {
            try {
                console.log(`[Notif] Starting payment proof notification for Order #${order.id}`);
                console.log(`[Notif] WA Client Status: ${getWaStatus()}`);

                const customerMsg = `[Migunani Motor] Bukti pembayaran untuk pesanan #${order.id} telah kami terima. Pembayaran Anda akan segera diverifikasi oleh tim finance kami. Terima kasih!`;
                // @ts-ignore
                const customerWaRaw = order.Customer?.whatsapp_number || (order as any).whatsapp_number;
                const customerWa = customerWaRaw ? String(customerWaRaw).trim() : '';

                console.log(`[Notif] Target Customer WA: ${customerWa}`);

                if (customerWa) {
                    const target = customerWa.includes('@c.us') ? customerWa : `${customerWa}@c.us`;
                    console.log(`[Notif] Sending to customer: ${target}`);
                    await waClient.sendMessage(target, customerMsg);
                    console.log(`[Notif] Sent to customer success`);
                } else {
                    console.warn(`[Notif] No customer WA found for order ${order.id}`);
                }

                // Notify Finance Admins
                const financeAdmins = await User.findAll({ where: { role: 'admin_finance', status: 'active' } });
                console.log(`[Notif] Finance Admins found: ${financeAdmins.length}`);

                const adminMsg = `[PEMBAYARAN] Bukti transfer baru diunggah untuk Invoice ${invoice.invoice_number || order.id}.\nCustomer: ${order.customer_name || 'Customer'}\nSilakan verifikasi di panel admin.`;

                for (const admin of financeAdmins) {
                    if (admin.whatsapp_number) {
                        const target = admin.whatsapp_number.includes('@c.us') ? admin.whatsapp_number : `${admin.whatsapp_number}@c.us`;
                        console.log(`[Notif] Sending to admin ${admin.name} (${target})`);
                        await waClient.sendMessage(target, adminMsg);
                    }
                }
                console.log(`[Notif] Notification sequence completed`);
            } catch (notifError) {
                console.error('[Notif] Notification error (full stack):', notifError);
            }
        })();

        res.json({ message: 'Payment proof uploaded' });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error uploading proof', error });
    }
};

// --- Admin Endpoints ---

export const getAllOrders = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, status, search, startDate, endDate, dateFrom, dateTo, is_backorder, exclude_backorder, updatedAfter } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        let prioritizeRecentIssueUpdates = false;
        if (status && status !== 'all') {
            const statusStr = String(status);
            const statuses = statusStr.split(',').map(s => s.trim()).filter(Boolean);

            if (statuses.length > 0) {
                if (statuses.includes('ready_to_ship') && !statuses.includes('waiting_payment')) {
                    statuses.push('waiting_payment');
                }
                if (statuses.includes('hold')) {
                    prioritizeRecentIssueUpdates = true;
                }
                whereClause.status = { [Op.in]: statuses };
            }
        }

        const wantsBackorder = is_backorder === 'true';
        const wantsExcludeBackorder = exclude_backorder === 'true';
        if (wantsBackorder || wantsExcludeBackorder) {
            const backorderRows = await Backorder.findAll({
                where: {
                    qty_pending: { [Op.gt]: 0 },
                    status: { [Op.notIn]: ['fulfilled', 'canceled'] }
                },
                include: [{ model: OrderItem, attributes: ['order_id'] }],
                attributes: ['order_item_id']
            });
            const backorderOrderIds = Array.from(new Set(
                backorderRows
                    .map((row: any) => row?.OrderItem?.order_id)
                    .filter(Boolean)
                    .map((id: any) => String(id))
            ));

            if (wantsBackorder) {
                if (backorderOrderIds.length === 0) {
                    return res.json({
                        total: 0,
                        totalPages: 0,
                        currentPage: Number(page),
                        orders: []
                    });
                }
                whereClause.id = { [Op.in]: backorderOrderIds };
            } else if (wantsExcludeBackorder && backorderOrderIds.length > 0) {
                whereClause.id = { [Op.notIn]: backorderOrderIds };
            }
        }

        const searchText = typeof search === 'string' ? search.trim() : '';
        if (searchText) {
            const invoiceMatches = await Invoice.findAll({
                where: { invoice_number: { [Op.like]: `%${searchText}%` } },
                attributes: ['id']
            });
            const invoiceIds = invoiceMatches.map((inv: any) => String(inv.id));
            const invoiceItems = invoiceIds.length > 0
                ? await InvoiceItem.findAll({
                    where: { invoice_id: { [Op.in]: invoiceIds } },
                    include: [{ model: OrderItem, attributes: ['order_id'] }]
                })
                : [];
            const orderIdsFromInvoice = Array.from(new Set(
                invoiceItems.map((item: any) => String(item?.OrderItem?.order_id || '')).filter(Boolean)
            ));

            whereClause[Op.or] = [
                { id: { [Op.like]: `%${searchText}%` } },
                { customer_name: { [Op.like]: `%${searchText}%` } },
                { customer_id: { [Op.like]: `%${searchText}%` } },
                ...(orderIdsFromInvoice.length > 0 ? [{ id: { [Op.in]: orderIdsFromInvoice } }] : []),
                { '$Customer.name$': { [Op.like]: `%${searchText}%` } },
            ];
        }

        const startRaw = typeof startDate === 'string' ? startDate : (typeof dateFrom === 'string' ? dateFrom : '');
        const endRaw = typeof endDate === 'string' ? endDate : (typeof dateTo === 'string' ? dateTo : '');

        const createdAtRange: any = {};

        if (startRaw) {
            const start = new Date(startRaw);
            if (!Number.isNaN(start.getTime())) {
                start.setHours(0, 0, 0, 0);
                createdAtRange[Op.gte] = start;
            }
        }

        if (endRaw) {
            const end = new Date(endRaw);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                createdAtRange[Op.lte] = end;
            }
        }

        if (Object.keys(createdAtRange).length > 0) {
            whereClause.createdAt = createdAtRange;
        }

        const updatedAfterRaw = typeof updatedAfter === 'string' ? updatedAfter : '';
        if (updatedAfterRaw) {
            const updatedAfterDate = new Date(updatedAfterRaw);
            if (!Number.isNaN(updatedAfterDate.getTime())) {
                whereClause.updatedAt = {
                    [Op.gte]: updatedAfterDate
                };
            }
        }

        const orders = await Order.findAndCountAll({
            where: whereClause,
            include: [
                { model: User, as: 'Customer', attributes: ['id', 'name'] },
                { model: User, as: 'Courier', attributes: ['id', 'name'] },
                {
                    model: OrderIssue,
                    as: 'Issues',
                    include: [{ model: User, as: 'IssueCreator', attributes: ['id', 'name', 'role'] }]
                },
                { model: Order, as: 'Children', attributes: ['id'] },
            ],
            distinct: true,
            limit: Number(limit),
            offset: Number(offset),
            order: prioritizeRecentIssueUpdates
                ? [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
                : [['createdAt', 'DESC']]
        });

        const plainRows = orders.rows.map((row) => row.get({ plain: true }) as any);
        const rowsWithInvoices = await attachInvoicesToOrders(plainRows);
        const rows = rowsWithInvoices.map((row) => withOrderTrackingFields(row as any));

        res.json({
            total: orders.count,
            totalPages: Math.ceil(orders.count / Number(limit)),
            currentPage: Number(page),
            orders: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error });
    }
};

export const getDeliveryEmployees = async (_req: Request, res: Response) => {
    try {
        const employees = await User.findAll({
            where: {
                status: 'active',
                role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
            },
            attributes: ['id', 'name', 'email', 'role', 'whatsapp_number'],
            order: [['name', 'ASC']]
        });

        res.json({
            employees: employees.map((item) => {
                const plain = item.get({ plain: true }) as any;
                return {
                    ...plain,
                    display_name: resolveEmployeeDisplayName(plain)
                };
            })
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching delivery employees', error });
    }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userRole = req.user!.role;
        const { status, courier_id, issue_type, issue_note, resolution_note } = req.body;

        const nextStatus = typeof status === 'string' ? status : '';
        if (!ORDER_STATUS_OPTIONS.includes(nextStatus as (typeof ORDER_STATUS_OPTIONS)[number])) {
            await t.rollback();
            return res.status(400).json({ message: 'Status order tidak valid' });
        }

        const order = await Order.findByPk(orderId, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }
        let prevStatus = String(order.status || '');
        if (prevStatus === 'waiting_payment') {
            await order.update({ status: 'ready_to_ship', expiry_date: null }, { transaction: t });
            order.status = 'ready_to_ship' as any;
            prevStatus = 'ready_to_ship';
        }

        // --- STRICT TRANSITION MAP ---
        // Other transitions are handled by dedicated endpoints:
        //   pending → waiting_invoice              (allocateOrder)
        //   waiting_invoice → ready_to_ship        (issueInvoice)
        //   shipped → delivered                     (completeDelivery)
        const ALLOWED_TRANSITIONS: Record<string, { roles: string[]; to: string[] }> = {
            'ready_to_ship': { roles: ['admin_gudang'], to: ['shipped'] },
            'hold': { roles: ['admin_gudang'], to: ['shipped'] },
            'delivered': { roles: ['admin_gudang', 'admin_finance'], to: ['completed'] },
        };
        const CANCELABLE_STATUSES = [
            'pending',
            'waiting_invoice',
            'ready_to_ship',
            'allocated',
            'partially_fulfilled',
            'debt_pending',
            'processing',
            'hold',
        ];
        const canCancelByRole = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(userRole);

        if (userRole !== 'super_admin') {
            if (nextStatus === 'canceled') {
                if (!canCancelByRole || !CANCELABLE_STATUSES.includes(order.status)) {
                    await t.rollback();
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa membatalkan order dengan status '${order.status}'.`
                    });
                }
            } else {
                const rule = ALLOWED_TRANSITIONS[order.status];
                if (!rule || !rule.roles.includes(userRole) || !rule.to.includes(nextStatus)) {
                    await t.rollback();
                    return res.status(403).json({
                        message: `Role '${userRole}' tidak bisa mengubah status dari '${order.status}' ke '${nextStatus}'. Gunakan fitur yang sesuai (alokasi, invoice, verifikasi).`
                    });
                }
            }
        }

        const normalizedResolutionNote = normalizeIssueNote(resolution_note);
        if (prevStatus === 'hold' && nextStatus === 'shipped' && !normalizedResolutionNote) {
            await t.rollback();
            return res.status(400).json({ message: 'Catatan follow-up wajib diisi sebelum kirim ulang order dari status hold.' });
        }

        // --- Courier validation for shipped ---
        let courierIdToSave: string | null = null;
        if (nextStatus === 'shipped') {
            if (typeof courier_id !== 'string' || !courier_id.trim()) {
                await t.rollback();
                return res.status(400).json({ message: 'Status dikirim wajib memilih driver/kurir' });
            }
            const courier = await User.findOne({
                where: {
                    id: courier_id.trim(),
                    status: 'active',
                    role: { [Op.in]: DELIVERY_EMPLOYEE_ROLES as unknown as string[] }
                },
                transaction: t
            });
            if (!courier) {
                await t.rollback();
                return res.status(404).json({ message: 'Driver/kurir tidak ditemukan atau tidak aktif' });
            }
            courierIdToSave = courier.id;
        }

        const updatePayload: any = { status: nextStatus };
        if (courierIdToSave) {
            updatePayload.courier_id = courierIdToSave;
        }
        await order.update(updatePayload, { transaction: t });

        if (nextStatus === 'shipped') {
            const invoice = await findLatestInvoiceByOrderId(orderId, { transaction: t });
            if (invoice && invoice.payment_method !== 'cod') {
                await AccountingPostingService.postGoodsOutForOrder(orderId, String(req.user!.id), t, 'non_cod');
            }
        }

        // --- Issue tracking for hold ---
        if (nextStatus === 'hold') {
            const normalizedIssueType = typeof issue_type === 'string' && issue_type.trim()
                ? issue_type.trim()
                : 'shortage';
            if (normalizedIssueType !== 'shortage') {
                await t.rollback();
                return res.status(400).json({ message: 'Issue type tidak valid.' });
            }
            const dueAt = new Date(Date.now() + (ISSUE_SLA_HOURS * 60 * 60 * 1000));
            const existingOpenIssue = await OrderIssue.findOne({
                where: { order_id: orderId, status: 'open', issue_type: 'shortage' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            if (existingOpenIssue) {
                await existingOpenIssue.update({ note: normalizeIssueNote(issue_note) }, { transaction: t });
            } else {
                await OrderIssue.create({
                    order_id: orderId, issue_type: 'shortage', status: 'open',
                    note: normalizeIssueNote(issue_note), due_at: dueAt,
                    created_by: req.user?.id || null,
                }, { transaction: t });
            }
        } else {
            const openIssues = await OrderIssue.findAll({
                where: { order_id: orderId, status: 'open' },
                transaction: t, lock: t.LOCK.UPDATE
            });
            for (const issue of openIssues) {
                const issueUpdatePayload: any = {
                    status: 'resolved',
                    resolved_at: new Date(),
                    resolved_by: req.user?.id || null,
                };
                if (normalizedResolutionNote && issue.issue_type === 'shortage') {
                    issueUpdatePayload.resolution_note = normalizedResolutionNote;
                }
                await issue.update({
                    ...issueUpdatePayload,
                }, { transaction: t });
            }
        }

        // If canceled, restore stock from allocations
        if (nextStatus === 'canceled' && order.stock_released === false) {
            const allocations = await OrderAllocation.findAll({
                where: { order_id: orderId }, transaction: t
            });
            for (const alloc of allocations) {
                if (alloc.allocated_qty > 0) {
                    const product = await Product.findByPk(alloc.product_id, {
                        transaction: t, lock: t.LOCK.UPDATE
                    });
                    if (product) {
                        await product.update({
                            stock_quantity: product.stock_quantity + alloc.allocated_qty,
                            allocated_quantity: Math.max(0, product.allocated_quantity - alloc.allocated_qty),
                        }, { transaction: t });
                    }
                }
            }
            await order.update({ stock_released: true }, { transaction: t });
        }

        await t.commit();
        if (nextStatus !== prevStatus) {
            const targetRoles = nextStatus === 'shipped'
                ? ['driver', 'customer']
                : nextStatus === 'delivered'
                    ? ['admin_finance', 'customer']
                    : nextStatus === 'hold'
                        ? ['admin_gudang', 'super_admin', 'customer']
                        : nextStatus === 'completed'
                            ? ['customer']
                            : ['admin_gudang', 'admin_finance', 'kasir', 'customer'];
            emitOrderStatusChanged({
                order_id: orderId,
                from_status: prevStatus || null,
                to_status: nextStatus,
                source: String(order.source || ''),
                payment_method: null,
                courier_id: courierIdToSave || String(order.courier_id || ''),
                triggered_by_role: userRole || null,
                target_roles: targetRoles,
                target_user_ids: courierIdToSave ? [courierIdToSave] : [],
            });
        } else {
            emitAdminRefreshBadges();
        }
        res.json({ message: `Order status updated to ${nextStatus}` });


    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error updating order status', error });
    }
};

export const reportMissingItem = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const orderId = String(req.params.id);
        const userId = req.user!.id;
        const { items, note } = req.body;
        // items: [{ product_id, qty_missing }]

        const order = await Order.findByPk(orderId, {
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!order) {
            await t.rollback();
            return res.status(404).json({ message: 'Order not found' });
        }

        // 1. Validate Status: Must be Delivered or Completed
        if (!['delivered', 'completed'].includes(order.status)) {
            await t.rollback();
            return res.status(400).json({ message: 'Laporan barang kurang hanya bisa dibuat setelah pesanan diterima (delivered/completed).' });
        }

        // 2. Validate Items
        if (!Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Daftar barang kurang wajib diisi.' });
        }

        const missingItemsData: string[] = [];

        for (const item of items) {
            const pid = String(item.product_id);
            const qtyMissing = Number(item.qty_missing);

            if (qtyMissing <= 0) continue;

            const orderItem = (order.OrderItems || []).find((oi: any) => String(oi.product_id) === pid);
            if (!orderItem) {
                await t.rollback();
                return res.status(400).json({ message: `Produk ID ${pid} tidak ada dalam pesanan ini.` });
            }

            if (qtyMissing > Number(orderItem.qty)) {
                await t.rollback();
                return res.status(400).json({ message: `Jumlah barang kurang untuk produk ${pid} melebihi jumlah pesanan.` });
            }

            const productName = (orderItem as any).Product?.name || pid;
            missingItemsData.push(`${productName} (Qty: ${qtyMissing})`);
        }

        if (missingItemsData.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item valid yang dilaporkan.' });
        }

        // 3. Create Order Issue
        const issueNote = `Barang Kurang: ${missingItemsData.join(', ')}. Catatan: ${note || '-'}`;
        const dueAt = new Date();
        dueAt.setHours(dueAt.getHours() + 48); // 48h SLA

        await OrderIssue.create({
            order_id: orderId,
            issue_type: 'missing_item', // Ensure this enum value is supported in your model
            status: 'open',
            note: issueNote,
            due_at: dueAt,
            created_by: userId
        }, { transaction: t });

        await t.commit();
        emitAdminRefreshBadges();
        res.status(201).json({ message: 'Laporan barang kurang berhasil dibuat. Tim kami akan segera melakukan verifikasi.' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Gagal membuat laporan barang kurang', error });
    }
};

export const getDashboardStats = async (req: Request, res: Response) => {
    try {
        const counts = await Order.findAll({
            attributes: [
                'status',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count']
            ],
            group: ['status'],
            raw: true
        }) as unknown as { status: string, count: number }[];

        const stats = {
            pending: 0,
            waiting_invoice: 0,
            waiting_payment: 0,
            delivered: 0,
            ready_to_ship: 0,
            shipped: 0,
            completed: 0,
            canceled: 0,
            waiting_admin_verification: 0,
            allocated: 0,
            partially_fulfilled: 0,
            debt_pending: 0,
            hold: 0,
            expired: 0,
            total: 0
        };

        counts.forEach(item => {
            const status = String(item.status || '');
            const count = Number(item.count || 0);
            if (status === 'waiting_payment') {
                stats.ready_to_ship += count;
                stats.total += count;
                return;
            }
            if (status && (stats as any)[status] !== undefined) {
                (stats as any)[status] = count;
            }
            stats.total += count;
        });

        res.json(stats);
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ message: 'Error fetching stats', error });
    }
};
