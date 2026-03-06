import { Transaction, Op } from 'sequelize';
import { Product, Setting } from '../models';

export type DiscountVoucher = {
    code: string;
    discount_pct: number;
    max_discount_rupiah: number;
    product_id: string | null;
    starts_at: string;
    expires_at: string;
    usage_limit: number;
    usage_count: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

const DISCOUNT_VOUCHERS_SETTING_KEY = 'discount_vouchers';

export class DiscountVoucherService {
    static normalizeCode(value: unknown): string {
        if (typeof value !== 'string') return '';
        return value
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '')
            .replace(/[^A-Z0-9_-]+/g, '');
    }

    static parseDiscountPct(value: unknown): number | null {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        if (parsed < 0 || parsed > 100) return null;
        return Math.round(parsed * 100) / 100;
    }

    static parseMoney(value: unknown): number | null {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        if (parsed < 0) return null;
        return Math.round(parsed);
    }

    static normalizeProductId(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }

    static parsePositiveInt(value: unknown): number | null {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        const floored = Math.floor(parsed);
        if (floored < 1) return null;
        return floored;
    }

    static parseNonNegativeInt(value: unknown, fallback = 0): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        const floored = Math.floor(parsed);
        if (floored < 0) return fallback;
        return floored;
    }

    static parseDateIso(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (!raw) return null;
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) return null;
        return date.toISOString();
    }

    static normalizeVoucher(value: unknown): DiscountVoucher | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const row = value as Record<string, unknown>;
        const code = this.normalizeCode(row.code);
        const discountPct = this.parseDiscountPct(row.discount_pct);
        const maxDiscount = this.parseMoney(row.max_discount_rupiah);
        const productId = this.normalizeProductId(row.product_id);
        const startsAt = this.parseDateIso(row.starts_at);
        const expiresAt = this.parseDateIso(row.expires_at);
        const usageLimit = this.parsePositiveInt(row.usage_limit);
        const usageCount = this.parseNonNegativeInt(row.usage_count, 0);
        const isActive = row.is_active !== false && !!productId;
        const createdAt = this.parseDateIso(row.created_at) || new Date().toISOString();
        const updatedAt = this.parseDateIso(row.updated_at) || new Date().toISOString();

        if (!code || code.length < 3 || code.length > 40) return null;
        if (discountPct === null) return null;
        if (maxDiscount === null) return null;
        if (!startsAt || !expiresAt) return null;
        if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) return null;
        if (usageLimit === null) return null;
        if (usageCount > usageLimit) return null;

        return {
            code,
            discount_pct: discountPct,
            max_discount_rupiah: maxDiscount,
            product_id: productId,
            starts_at: startsAt,
            expires_at: expiresAt,
            usage_limit: usageLimit,
            usage_count: usageCount,
            is_active: isActive,
            created_at: createdAt,
            updated_at: updatedAt
        };
    }

    static sortVouchers(rows: DiscountVoucher[]): DiscountVoucher[] {
        return [...rows].sort((a, b) => {
            const aTime = new Date(a.created_at).getTime();
            const bTime = new Date(b.created_at).getTime();
            if (aTime !== bTime) return bTime - aTime;
            return a.code.localeCompare(b.code, 'id');
        });
    }

    static normalizeVoucherArray(raw: unknown): DiscountVoucher[] {
        const source = Array.isArray(raw) ? raw : [];
        const deduped = new Map<string, DiscountVoucher>();
        source.forEach((item) => {
            const voucher = this.normalizeVoucher(item);
            if (!voucher) return;
            deduped.set(voucher.code, voucher);
        });
        return this.sortVouchers(Array.from(deduped.values()));
    }

    static async getSettingTransaction(): Promise<Transaction> {
        if (!Setting.sequelize) {
            throw new Error('Database connection unavailable');
        }
        return Setting.sequelize.transaction();
    }

    static async loadOrInitVouchers(options?: {
        transaction?: Transaction;
        lockForUpdate?: boolean;
    }): Promise<DiscountVoucher[]> {
        const transaction = options?.transaction;
        const lockForUpdate = options?.lockForUpdate === true;
        const findOptions: any = {};
        if (transaction) {
            findOptions.transaction = transaction;
            if (lockForUpdate) {
                findOptions.lock = transaction.LOCK.UPDATE;
            }
        }

        let existing = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY, findOptions);
        if (!existing) {
            try {
                await Setting.create({
                    key: DISCOUNT_VOUCHERS_SETTING_KEY,
                    value: [],
                    description: 'Manajemen voucher diskon customer'
                }, transaction ? { transaction } : undefined);
            } catch (error: any) {
                if (error?.name !== 'SequelizeUniqueConstraintError') {
                    throw error;
                }
            }
            existing = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY, findOptions);
            if (!existing) {
                throw new Error('Failed to initialize discount voucher settings');
            }
        }

        const normalized = this.normalizeVoucherArray(existing.value);
        if (JSON.stringify(normalized) !== JSON.stringify(existing.value)) {
            await existing.update({ value: normalized }, transaction ? { transaction } : undefined);
        }
        return normalized;
    }

    static async saveVouchers(rows: DiscountVoucher[], transaction?: Transaction) {
        const sorted = this.sortVouchers(rows);
        const payload = {
            key: DISCOUNT_VOUCHERS_SETTING_KEY,
            value: sorted,
            description: 'Manajemen voucher diskon customer'
        };

        if (transaction) {
            const existing = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY, {
                transaction,
                lock: transaction.LOCK.UPDATE
            });
            if (existing) {
                await existing.update(payload, { transaction });
            } else {
                try {
                    await Setting.create(payload, { transaction });
                } catch (error: any) {
                    if (error?.name !== 'SequelizeUniqueConstraintError') {
                        throw error;
                    }
                    const row = await Setting.findByPk(DISCOUNT_VOUCHERS_SETTING_KEY, {
                        transaction,
                        lock: transaction.LOCK.UPDATE
                    });
                    if (row) {
                        await row.update(payload, { transaction });
                    } else {
                        await Setting.upsert(payload, { transaction });
                    }
                }
            }
            return sorted;
        }

        await Setting.upsert(payload);
        return sorted;
    }

    static resolveExpiresAt(rawExpiresAt: unknown, rawValidDays: unknown, startsAtIso: string): string | null {
        const parsedExpires = this.parseDateIso(rawExpiresAt);
        if (parsedExpires) return parsedExpires;

        if (rawValidDays === undefined || rawValidDays === null || String(rawValidDays).trim() === '') {
            return null;
        }

        const validDays = this.parsePositiveInt(rawValidDays);
        if (validDays === null) return null;

        const startsAtMs = new Date(startsAtIso).getTime();
        return new Date(startsAtMs + (validDays * 24 * 60 * 60 * 1000)).toISOString();
    }

    static async getDiscountVouchers(activeOnly: boolean, availableOnly: boolean) {
        const now = Date.now();
        const vouchers = await this.loadOrInitVouchers();
        const rows = vouchers.filter((voucher) => {
            if (activeOnly && !voucher.is_active) return false;
            if (availableOnly) {
                const startMs = new Date(voucher.starts_at).getTime();
                const endMs = new Date(voucher.expires_at).getTime();
                const withinWindow = now >= startMs && now <= endMs;
                const hasQuota = voucher.usage_count < voucher.usage_limit;
                return voucher.is_active && withinWindow && hasQuota;
            }
            return true;
        });

        const productIds = Array.from(new Set(rows.map((voucher) => voucher.product_id).filter(Boolean))) as string[];
        const products = productIds.length > 0
            ? await Product.findAll({
                where: { id: { [Op.in]: productIds } },
                attributes: ['id', 'name', 'sku']
            })
            : [];
        const productMap = new Map<string, { name: string; sku: string }>();
        products.forEach((product: any) => {
            productMap.set(String(product.id), {
                name: String(product.name || ''),
                sku: String(product.sku || '')
            });
        });

        return rows.map((voucher) => {
            const productId = voucher.product_id ? String(voucher.product_id) : '';
            const product = productId ? productMap.get(productId) : null;
            return {
                ...voucher,
                product_name: product?.name || null,
                product_sku: product?.sku || null
            };
        });
    }

    static async createDiscountVoucher(payload: any) {
        const t = await this.getSettingTransaction();
        try {
            const vouchers = await this.loadOrInitVouchers({ transaction: t, lockForUpdate: true });

            const code = this.normalizeCode(payload?.code);
            const discountPct = this.parseDiscountPct(payload?.discount_pct);
            const maxDiscountRupiah = this.parseMoney(payload?.max_discount_rupiah);
            const productId = this.normalizeProductId(payload?.product_id);
            const usageLimit = this.parsePositiveInt(payload?.usage_limit);
            const startsAt = this.parseDateIso(payload?.starts_at) || new Date().toISOString();
            const expiresAt = this.resolveExpiresAt(payload?.expires_at, payload?.valid_days, startsAt);
            const isActive = payload?.is_active !== false;

            if (!code || code.length < 3 || code.length > 40) {
                throw new Error('Kode voucher wajib 3-40 karakter (A-Z, 0-9, _ atau -).');
            }
            if (discountPct === null) {
                throw new Error('Persentase diskon wajib angka valid 0-100.');
            }
            if (maxDiscountRupiah === null) {
                throw new Error('Maksimal potongan rupiah tidak valid.');
            }
            if (!productId) {
                throw new Error('Produk voucher wajib dipilih.');
            }
            const product = await Product.findByPk(productId, { transaction: t });
            if (!product) {
                throw new Error('Produk voucher tidak ditemukan.');
            }
            if (usageLimit === null) {
                throw new Error('Batas pemakaian voucher wajib angka bulat >= 1.');
            }
            if (!expiresAt) {
                throw new Error('Tanggal berakhir atau umur diskon (hari) wajib diisi.');
            }
            if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
                throw new Error('Tanggal berakhir harus lebih besar dari tanggal mulai.');
            }
            if (vouchers.some((voucher) => voucher.code === code)) {
                throw new Error('Kode voucher sudah digunakan.');
            }

            const now = new Date().toISOString();
            const created: DiscountVoucher = {
                code,
                discount_pct: discountPct,
                max_discount_rupiah: maxDiscountRupiah,
                product_id: productId,
                starts_at: startsAt,
                expires_at: expiresAt,
                usage_limit: usageLimit,
                usage_count: 0,
                is_active: isActive,
                created_at: now,
                updated_at: now
            };

            const saved = await this.saveVouchers([...vouchers, created], t);
            await t.commit();
            return saved;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }

    static async updateDiscountVoucher(paramCode: string, payload: any) {
        const t = await this.getSettingTransaction();
        try {
            const code = this.normalizeCode(paramCode);
            if (!code) {
                throw new Error('Kode voucher tidak valid.');
            }

            const vouchers = await this.loadOrInitVouchers({ transaction: t, lockForUpdate: true });
            const targetIndex = vouchers.findIndex((voucher) => voucher.code === code);
            if (targetIndex < 0) {
                throw new Error('Voucher diskon tidak ditemukan.');
            }

            const current = vouchers[targetIndex];
            const nextDiscountPct = payload?.discount_pct !== undefined
                ? this.parseDiscountPct(payload.discount_pct)
                : current.discount_pct;
            const nextMaxDiscount = payload?.max_discount_rupiah !== undefined
                ? this.parseMoney(payload.max_discount_rupiah)
                : current.max_discount_rupiah;
            const nextProductId = payload?.product_id !== undefined
                ? this.normalizeProductId(payload.product_id)
                : current.product_id;
            const nextUsageLimit = payload?.usage_limit !== undefined
                ? this.parsePositiveInt(payload.usage_limit)
                : current.usage_limit;
            const nextStartsAt = payload?.starts_at !== undefined
                ? this.parseDateIso(payload.starts_at)
                : current.starts_at;

            if (!nextStartsAt) {
                throw new Error('Tanggal mulai diskon tidak valid.');
            }

            let nextExpiresAt = current.expires_at;
            if (payload?.expires_at !== undefined || payload?.valid_days !== undefined || payload?.starts_at !== undefined) {
                const resolved = this.resolveExpiresAt(
                    payload?.expires_at !== undefined ? payload.expires_at : current.expires_at,
                    payload?.valid_days,
                    nextStartsAt
                );
                if (!resolved) {
                    throw new Error('Tanggal berakhir/umur diskon tidak valid.');
                }
                nextExpiresAt = resolved;
            }

            const nextIsActive = payload?.is_active !== undefined ? payload.is_active !== false : current.is_active;

            if (nextDiscountPct === null) {
                throw new Error('Persentase diskon harus angka 0-100.');
            }
            if (nextMaxDiscount === null) {
                throw new Error('Maksimal potongan rupiah tidak valid.');
            }
            if (!nextProductId) {
                throw new Error('Produk voucher wajib dipilih.');
            }
            const product = await Product.findByPk(nextProductId, { transaction: t });
            if (!product) {
                throw new Error('Produk voucher tidak ditemukan.');
            }
            if (nextUsageLimit === null) {
                throw new Error('Batas pemakaian voucher harus angka bulat >= 1.');
            }
            if (nextUsageLimit < current.usage_count) {
                throw new Error('Batas pemakaian tidak boleh lebih kecil dari jumlah pemakaian saat ini.');
            }
            if (new Date(nextExpiresAt).getTime() <= new Date(nextStartsAt).getTime()) {
                throw new Error('Tanggal berakhir harus lebih besar dari tanggal mulai.');
            }

            const nextRows = [...vouchers];
            nextRows[targetIndex] = {
                ...current,
                discount_pct: nextDiscountPct,
                max_discount_rupiah: nextMaxDiscount,
                product_id: nextProductId,
                usage_limit: nextUsageLimit,
                starts_at: nextStartsAt,
                expires_at: nextExpiresAt,
                is_active: nextIsActive,
                updated_at: new Date().toISOString()
            };

            const saved = await this.saveVouchers(nextRows, t);
            await t.commit();
            return saved;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }

    static async removeDiscountVoucher(paramCode: string) {
        const t = await this.getSettingTransaction();
        try {
            const code = this.normalizeCode(paramCode);
            if (!code) {
                throw new Error('Kode voucher tidak valid.');
            }

            const vouchers = await this.loadOrInitVouchers({ transaction: t, lockForUpdate: true });
            const exists = vouchers.some((voucher) => voucher.code === code);
            if (!exists) {
                throw new Error('Voucher diskon tidak ditemukan.');
            }

            const saved = await this.saveVouchers(vouchers.filter((voucher) => voucher.code !== code), t);
            await t.commit();
            return saved;
        } catch (error) {
            try { await t.rollback(); } catch { }
            throw error;
        }
    }
}
