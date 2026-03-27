import { Op, Transaction } from 'sequelize';
import { CustomerOtpSession, ALLOWED_TIERS } from './types';
import { OrderAllocation, Product } from '../../models';
import { InventoryReservationService } from '../../services/InventoryReservationService';

export const customerOtpMap = new Map<string, CustomerOtpSession>();

export const cleanupOtpSessions = () => {
    const now = Date.now();
    for (const [key, value] of customerOtpMap.entries()) {
        if (value.expiresAt <= now) {
            customerOtpMap.delete(key);
        }
    }
};

export const normalizeId = (value: unknown): string => {
    if (Array.isArray(value)) {
        return String(value[0] || '').trim();
    }
    return String(value || '').trim();
};

export const parsePositiveNumber = (value: unknown, fallback: number, max: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
};

export const normalizeTier = (value: unknown): (typeof ALLOWED_TIERS)[number] => {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (ALLOWED_TIERS.includes(raw as (typeof ALLOWED_TIERS)[number])) {
        return raw as (typeof ALLOWED_TIERS)[number];
    }
    return 'regular';
};

export const normalizeEmail = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email || null;
};

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const applyCustomerSearch = (whereClause: any, search: unknown) => {
    const keyword = typeof search === 'string' ? search.trim() : '';
    if (!keyword) return;

    whereClause[Op.or] = [
        { name: { [Op.like]: `%${keyword}%` } },
        { whatsapp_number: { [Op.like]: `%${keyword}%` } },
        { email: { [Op.like]: `%${keyword}%` } }
    ];
};

export const applyStatusFilter = (whereClause: any, status: unknown) => {
    const statusParam = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!statusParam || statusParam === 'all') return;
    if (!['active', 'banned'].includes(statusParam)) return;
    whereClause.status = statusParam;
};

export const releaseOrderAllocationStock = async (orderId: string, t: Transaction) => {
    const allocations = await OrderAllocation.findAll({
        where: { order_id: orderId },
        transaction: t,
        lock: t.LOCK.UPDATE
    });

    for (const alloc of allocations) {
        if (!alloc.allocated_qty || alloc.allocated_qty <= 0) continue;

        const product = await Product.findByPk(alloc.product_id, {
            transaction: t,
            lock: t.LOCK.UPDATE
        });
        if (!product) continue;

        await product.update({
            stock_quantity: Number(product.stock_quantity || 0) + Number(alloc.allocated_qty || 0),
            allocated_quantity: Math.max(0, Number(product.allocated_quantity || 0) - Number(alloc.allocated_qty || 0)),
        }, { transaction: t });
    }

    await InventoryReservationService.releaseReservationsForOrder({ order_id: orderId, transaction: t });
};
