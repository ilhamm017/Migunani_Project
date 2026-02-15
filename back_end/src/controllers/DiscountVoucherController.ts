import { Request, Response } from 'express';
import { Transaction } from 'sequelize';
import { Setting } from '../models';

type DiscountVoucher = {
    code: string;
    discount_pct: number;
    max_discount_rupiah: number;
    starts_at: string;
    expires_at: string;
    usage_limit: number;
    usage_count: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

const DISCOUNT_VOUCHERS_SETTING_KEY = 'discount_vouchers';

const normalizeCode = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9_-]+/g, '');
};

const parseDiscountPct = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 0 || parsed > 100) return null;
    return Math.round(parsed * 100) / 100;
};

const parseMoney = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 0) return null;
    return Math.round(parsed);
};

const parsePositiveInt = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const floored = Math.floor(parsed);
    if (floored < 1) return null;
    return floored;
};

const parseNonNegativeInt = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const floored = Math.floor(parsed);
    if (floored < 0) return fallback;
    return floored;
};

const parseDateIso = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
};

const normalizeVoucher = (value: unknown): DiscountVoucher | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const code = normalizeCode(row.code);
    const discountPct = parseDiscountPct(row.discount_pct);
    const maxDiscount = parseMoney(row.max_discount_rupiah);
    const startsAt = parseDateIso(row.starts_at);
    const expiresAt = parseDateIso(row.expires_at);
    const usageLimit = parsePositiveInt(row.usage_limit);
    const usageCount = parseNonNegativeInt(row.usage_count, 0);
    const isActive = row.is_active !== false;
    const createdAt = parseDateIso(row.created_at) || new Date().toISOString();
    const updatedAt = parseDateIso(row.updated_at) || new Date().toISOString();

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
        starts_at: startsAt,
        expires_at: expiresAt,
        usage_limit: usageLimit,
        usage_count: usageCount,
        is_active: isActive,
        created_at: createdAt,
        updated_at: updatedAt
    };
};

const sortVouchers = (rows: DiscountVoucher[]): DiscountVoucher[] => {
    return [...rows].sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return a.code.localeCompare(b.code, 'id');
    });
};

const normalizeVoucherArray = (raw: unknown): DiscountVoucher[] => {
    const source = Array.isArray(raw) ? raw : [];
    const deduped = new Map<string, DiscountVoucher>();
    source.forEach((item) => {
        const voucher = normalizeVoucher(item);
        if (!voucher) return;
        deduped.set(voucher.code, voucher);
    });
    return sortVouchers(Array.from(deduped.values()));
};

const getSettingTransaction = async (): Promise<Transaction> => {
    if (!Setting.sequelize) {
        throw new Error('Database connection unavailable');
    }
    return Setting.sequelize.transaction();
};

const loadOrInitVouchers = async (options?: {
    transaction?: Transaction;
    lockForUpdate?: boolean;
}): Promise<DiscountVoucher[]> => {
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

    const normalized = normalizeVoucherArray(existing.value);
    if (JSON.stringify(normalized) !== JSON.stringify(existing.value)) {
        await existing.update({ value: normalized }, transaction ? { transaction } : undefined);
    }
    return normalized;
};

const saveVouchers = async (rows: DiscountVoucher[], transaction?: Transaction) => {
    const sorted = sortVouchers(rows);
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
};

const resolveExpiresAt = (rawExpiresAt: unknown, rawValidDays: unknown, startsAtIso: string): string | null => {
    const parsedExpires = parseDateIso(rawExpiresAt);
    if (parsedExpires) return parsedExpires;

    if (rawValidDays === undefined || rawValidDays === null || String(rawValidDays).trim() === '') {
        return null;
    }

    const validDays = parsePositiveInt(rawValidDays);
    if (validDays === null) return null;

    const startsAtMs = new Date(startsAtIso).getTime();
    return new Date(startsAtMs + (validDays * 24 * 60 * 60 * 1000)).toISOString();
};

export const getDiscountVouchers = async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const availableOnly = String(req.query.available_only || '').trim() === 'true';
        const now = Date.now();

        const vouchers = await loadOrInitVouchers();
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

        return res.json({ discount_vouchers: rows });
    } catch (error) {
        return res.status(500).json({ message: 'Gagal memuat voucher diskon', error });
    }
};

export const createDiscountVoucher = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const vouchers = await loadOrInitVouchers({ transaction: t, lockForUpdate: true });

        const code = normalizeCode(req.body?.code);
        const discountPct = parseDiscountPct(req.body?.discount_pct);
        const maxDiscountRupiah = parseMoney(req.body?.max_discount_rupiah);
        const usageLimit = parsePositiveInt(req.body?.usage_limit);
        const startsAt = parseDateIso(req.body?.starts_at) || new Date().toISOString();
        const expiresAt = resolveExpiresAt(req.body?.expires_at, req.body?.valid_days, startsAt);
        const isActive = req.body?.is_active !== false;

        if (!code || code.length < 3 || code.length > 40) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode voucher wajib 3-40 karakter (A-Z, 0-9, _ atau -).' });
        }
        if (discountPct === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Persentase diskon wajib angka valid 0-100.' });
        }
        if (maxDiscountRupiah === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Maksimal potongan rupiah tidak valid.' });
        }
        if (usageLimit === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Batas pemakaian voucher wajib angka bulat >= 1.' });
        }
        if (!expiresAt) {
            await t.rollback();
            return res.status(400).json({ message: 'Tanggal berakhir atau umur diskon (hari) wajib diisi.' });
        }
        if (new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
            await t.rollback();
            return res.status(400).json({ message: 'Tanggal berakhir harus lebih besar dari tanggal mulai.' });
        }
        if (vouchers.some((voucher) => voucher.code === code)) {
            await t.rollback();
            return res.status(409).json({ message: 'Kode voucher sudah digunakan.' });
        }

        const now = new Date().toISOString();
        const created: DiscountVoucher = {
            code,
            discount_pct: discountPct,
            max_discount_rupiah: maxDiscountRupiah,
            starts_at: startsAt,
            expires_at: expiresAt,
            usage_limit: usageLimit,
            usage_count: 0,
            is_active: isActive,
            created_at: now,
            updated_at: now
        };

        const saved = await saveVouchers([...vouchers, created], t);
        await t.commit();
        return res.status(201).json({
            message: 'Voucher diskon berhasil ditambahkan.',
            discount_vouchers: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal menambahkan voucher diskon', error });
    }
};

export const updateDiscountVoucher = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const code = normalizeCode(req.params.code);
        if (!code) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode voucher tidak valid.' });
        }

        const vouchers = await loadOrInitVouchers({ transaction: t, lockForUpdate: true });
        const targetIndex = vouchers.findIndex((voucher) => voucher.code === code);
        if (targetIndex < 0) {
            await t.rollback();
            return res.status(404).json({ message: 'Voucher diskon tidak ditemukan.' });
        }

        const current = vouchers[targetIndex];
        const nextDiscountPct = req.body?.discount_pct !== undefined
            ? parseDiscountPct(req.body.discount_pct)
            : current.discount_pct;
        const nextMaxDiscount = req.body?.max_discount_rupiah !== undefined
            ? parseMoney(req.body.max_discount_rupiah)
            : current.max_discount_rupiah;
        const nextUsageLimit = req.body?.usage_limit !== undefined
            ? parsePositiveInt(req.body.usage_limit)
            : current.usage_limit;
        const nextStartsAt = req.body?.starts_at !== undefined
            ? parseDateIso(req.body.starts_at)
            : current.starts_at;

        if (!nextStartsAt) {
            await t.rollback();
            return res.status(400).json({ message: 'Tanggal mulai diskon tidak valid.' });
        }

        let nextExpiresAt = current.expires_at;
        if (req.body?.expires_at !== undefined || req.body?.valid_days !== undefined || req.body?.starts_at !== undefined) {
            const resolved = resolveExpiresAt(
                req.body?.expires_at !== undefined ? req.body.expires_at : current.expires_at,
                req.body?.valid_days,
                nextStartsAt
            );
            if (!resolved) {
                await t.rollback();
                return res.status(400).json({ message: 'Tanggal berakhir/umur diskon tidak valid.' });
            }
            nextExpiresAt = resolved;
        }

        const nextIsActive = req.body?.is_active !== undefined ? req.body.is_active !== false : current.is_active;

        if (nextDiscountPct === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Persentase diskon harus angka 0-100.' });
        }
        if (nextMaxDiscount === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Maksimal potongan rupiah tidak valid.' });
        }
        if (nextUsageLimit === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Batas pemakaian voucher harus angka bulat >= 1.' });
        }
        if (nextUsageLimit < current.usage_count) {
            await t.rollback();
            return res.status(400).json({ message: 'Batas pemakaian tidak boleh lebih kecil dari jumlah pemakaian saat ini.' });
        }
        if (new Date(nextExpiresAt).getTime() <= new Date(nextStartsAt).getTime()) {
            await t.rollback();
            return res.status(400).json({ message: 'Tanggal berakhir harus lebih besar dari tanggal mulai.' });
        }

        const nextRows = [...vouchers];
        nextRows[targetIndex] = {
            ...current,
            discount_pct: nextDiscountPct,
            max_discount_rupiah: nextMaxDiscount,
            usage_limit: nextUsageLimit,
            starts_at: nextStartsAt,
            expires_at: nextExpiresAt,
            is_active: nextIsActive,
            updated_at: new Date().toISOString()
        };

        const saved = await saveVouchers(nextRows, t);
        await t.commit();
        return res.json({
            message: 'Voucher diskon berhasil diperbarui.',
            discount_vouchers: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal memperbarui voucher diskon', error });
    }
};

export const removeDiscountVoucher = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const code = normalizeCode(req.params.code);
        if (!code) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode voucher tidak valid.' });
        }

        const vouchers = await loadOrInitVouchers({ transaction: t, lockForUpdate: true });
        const exists = vouchers.some((voucher) => voucher.code === code);
        if (!exists) {
            await t.rollback();
            return res.status(404).json({ message: 'Voucher diskon tidak ditemukan.' });
        }

        const saved = await saveVouchers(vouchers.filter((voucher) => voucher.code !== code), t);
        await t.commit();
        return res.json({
            message: 'Voucher diskon berhasil dihapus.',
            discount_vouchers: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal menghapus voucher diskon', error });
    }
};
