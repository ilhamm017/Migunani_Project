import { Request, Response } from 'express';
import { Order, OrderIssue, OrderItem, Product, Invoice, InvoiceItem, Cart, CartItem, User, sequelize, OrderAllocation, CustomerProfile, Retur, Backorder, Category, Setting } from '../../models';
import { Op } from 'sequelize';
import { resolveShippingMethodByCode } from '../ShippingMethodController';
import waClient, { getStatus as getWaStatus } from '../../services/whatsappClient';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitOrderStatusChanged } from '../../utils/orderNotification';
import { attachInvoicesToOrders, findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';


// --- Customer Endpoints ---
export const DELIVERY_EMPLOYEE_ROLES = ['driver'] as const;
export const ORDER_STATUS_OPTIONS = ['pending', 'waiting_invoice', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'hold', 'waiting_admin_verification'] as const;
export const ISSUE_SLA_HOURS = 24;
export const ALLOWED_PAYMENT_METHODS = ['transfer_manual', 'cod', 'cash_store'] as const;
export type CheckoutPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];
export type NormalizedCheckoutItem = {
    product_id: string;
    qty: number;
    unit_price_override?: number;
    unit_price_override_reason?: string | null;
};
export type CheckoutShippingMethod = { code: string; name: string; fee: number };

export const GENERIC_CUSTOMER_NAMES = new Set([
    'customer',
    'super_admin',
    'admin_gudang',
    'admin_finance',
    'driver'
]);

export const isGenericCustomerName = (value: unknown): boolean => {
    if (typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    return GENERIC_CUSTOMER_NAMES.has(normalized);
};

export const resolveCustomerName = (orderLike: any): string => {
    const rawName = typeof orderLike?.customer_name === 'string' ? orderLike.customer_name.trim() : '';
    if (!isGenericCustomerName(rawName)) return rawName;

    const relatedName = typeof orderLike?.Customer?.name === 'string'
        ? orderLike.Customer.name.trim()
        : '';
    if (relatedName) return relatedName;

    return rawName || 'Customer';
};

export const resolveEmployeeDisplayName = (userLike: any): string => {
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

export const getActiveIssue = (orderLike: any) => {
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

export const withOrderTrackingFields = (orderLike: any) => {
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


export const normalizeIssueNote = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

export const toObjectOrEmpty = (value: unknown): Record<string, unknown> => {
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

export const toFiniteNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
};

export const normalizeCheckoutItems = (value: unknown): NormalizedCheckoutItem[] | null => {
    if (!Array.isArray(value)) return null;
    const normalized: NormalizedCheckoutItem[] = [];

    for (const rawItem of value) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return null;
        const item = rawItem as Record<string, unknown>;
        const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
        const qty = Number(item.qty);

        if (!productId) return null;
        if (!Number.isInteger(qty) || qty <= 0) return null;

        const overrideRaw = item.unit_price_override;
        const override = overrideRaw === undefined || overrideRaw === null || overrideRaw === ''
            ? undefined
            : Number(overrideRaw);
        if (override !== undefined) {
            if (!Number.isFinite(override) || override <= 0) return null;
        }

        const reasonRaw = item.unit_price_override_reason;
        const reason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';

        normalized.push({
            product_id: productId,
            qty,
            ...(override !== undefined ? { unit_price_override: override } : {}),
            unit_price_override_reason: reason ? reason : null
        });
    }

    return normalized;
};


export const normalizeShippingMethodCode = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
};

export const FALLBACK_SHIPPING_METHODS: Record<string, CheckoutShippingMethod> = {
    kurir_reguler: { code: 'kurir_reguler', name: 'Kurir Reguler', fee: 12000 },
    same_day: { code: 'same_day', name: 'Same Day', fee: 25000 },
    pickup: { code: 'pickup', name: 'Ambil di Toko', fee: 0 }
};

export const resolveShippingMethodForCheckout = async (codeRaw: unknown): Promise<CheckoutShippingMethod | null> => {
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




export const resolveTierPriceFromVariant = (basePrice: number, tier: string, variantRaw: unknown): number => {
    const normalizedTier = String(tier || 'regular').trim().toLowerCase() === 'premium'
        ? 'platinum'
        : String(tier || 'regular').trim().toLowerCase();

    const source = toObjectOrEmpty(variantRaw);
    const prices = toObjectOrEmpty(source.prices);

    const toFiniteNumber = (value: unknown): number | null => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return parsed;
    };

    const resolveBasePriceFallback = (): number => {
        const normalizedBase = toFiniteNumber(basePrice);
        if (normalizedBase !== null && normalizedBase > 0) return normalizedBase;

        const baseCandidates: unknown[] = [
            prices.regular,
            source.regular,
            prices.base_price,
            source.base_price,
            prices.price,
            source.price
        ];

        for (const candidate of baseCandidates) {
            const parsed = toFiniteNumber(candidate);
            if (parsed !== null && parsed > 0) return parsed;
        }

        return Math.max(0, Number(basePrice || 0));
    };

    const effectiveBasePrice = resolveBasePriceFallback();

    if (normalizedTier === 'regular') return effectiveBasePrice;

    const discounts = toObjectOrEmpty(source.discounts_pct);
    const aliases = normalizedTier === 'platinum' ? ['premium'] : [];

    const directCandidates: unknown[] = [
        source[normalizedTier],
        prices[normalizedTier],
        toObjectOrEmpty(source[normalizedTier]).price
    ];

    for (const alias of aliases) {
        directCandidates.push(source[alias], prices[alias], toObjectOrEmpty(source[alias]).price);
    }

    for (const candidate of directCandidates) {
        const direct = toFiniteNumber(candidate);
        if (direct !== null) return Math.max(0, direct);
    }

    const discountCandidates: unknown[] = [
        discounts[normalizedTier],
        toObjectOrEmpty(source[normalizedTier]).discount_pct,
        source[`${normalizedTier}_discount_pct`]
    ];
    for (const alias of aliases) {
        discountCandidates.push(discounts[alias], toObjectOrEmpty(source[alias]).discount_pct, source[`${alias}_discount_pct`]);
    }

    for (const discountRaw of discountCandidates) {
        const discountPct = toFiniteNumber(discountRaw);
        if (discountPct === null) continue;
        if (discountPct < 0 || discountPct > 100) continue;
        return Math.max(0, Math.round((effectiveBasePrice * (1 - discountPct / 100)) * 100) / 100);
    }

    return effectiveBasePrice;
};

const tryResolveTierPriceDirect = (variantRaw: unknown, tier: string): number | null => {
    const normalizedTier = String(tier || 'regular').trim().toLowerCase() === 'premium'
        ? 'platinum'
        : String(tier || 'regular').trim().toLowerCase();
    if (normalizedTier === 'regular') return null;

    const source = toObjectOrEmpty(variantRaw);
    const prices = toObjectOrEmpty(source.prices);
    const aliases = normalizedTier === 'platinum' ? ['premium'] : [];

    const directCandidates: unknown[] = [
        source[normalizedTier],
        prices[normalizedTier],
        toObjectOrEmpty(source[normalizedTier]).price
    ];
    for (const alias of aliases) {
        directCandidates.push(source[alias], prices[alias], toObjectOrEmpty(source[alias]).price);
    }

    for (const candidate of directCandidates) {
        const parsed = Number(candidate);
        if (!Number.isFinite(parsed)) continue;
        return Math.max(0, parsed);
    }

    return null;
};

export const resolveCategoryDiscountPct = (categoryRaw: unknown, tier: string): number | null => {
    const category = toObjectOrEmpty(categoryRaw);
    const normalizedTier = String(tier || 'regular').trim().toLowerCase() === 'premium'
        ? 'platinum'
        : String(tier || 'regular').trim().toLowerCase();
    const key = normalizedTier === 'platinum' ? 'discount_premium_pct' : `discount_${normalizedTier}_pct`;
    const rawValue = category[key];
    const parsed = toFiniteNumber(rawValue);
    if (parsed === null) return null;
    if (parsed < 0 || parsed > 100) return null;
    return parsed;
};

export const resolveEffectiveTierPricing = (
    basePrice: number,
    tierRaw: string,
    variantRaw: unknown,
    categoryRaw: unknown
): { finalPrice: number; discountPct: number; discountSource: 'category' | 'tier_fallback' | 'none' } => {
    const tier = String(tierRaw || 'regular').trim().toLowerCase();
    const normalizedTier = tier === 'premium' ? 'platinum' : tier;
    const effectiveBasePrice = resolveTierPriceFromVariant(basePrice, 'regular', variantRaw);

    const directTierPrice = tryResolveTierPriceDirect(variantRaw, normalizedTier);
    if (directTierPrice !== null) {
        const discountPct = effectiveBasePrice <= 0
            ? 0
            : Math.min(100, Math.max(0, Math.round((((effectiveBasePrice - directTierPrice) / effectiveBasePrice) * 100) * 100) / 100));
        return { finalPrice: directTierPrice, discountPct, discountSource: 'tier_fallback' };
    }

    const categoryDiscountPct = resolveCategoryDiscountPct(categoryRaw, normalizedTier);
    if (categoryDiscountPct !== null) {
        const finalPrice = Math.max(0, Math.round((effectiveBasePrice * (1 - categoryDiscountPct / 100)) * 100) / 100);
        return { finalPrice, discountPct: categoryDiscountPct, discountSource: 'category' };
    }

    if (normalizedTier === 'regular') {
        return { finalPrice: effectiveBasePrice, discountPct: 0, discountSource: 'none' };
    }

    const tierFallbackPrice = resolveTierPriceFromVariant(effectiveBasePrice, normalizedTier, variantRaw);
    const normalizedPrice = Math.max(0, tierFallbackPrice);
    const discountPct = effectiveBasePrice <= 0
        ? 0
        : Math.min(100, Math.max(0, Math.round((((effectiveBasePrice - normalizedPrice) / effectiveBasePrice) * 100) * 100) / 100));
    return { finalPrice: normalizedPrice, discountPct, discountSource: 'tier_fallback' };
};





// --- Admin Endpoints ---


