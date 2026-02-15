import { Request, Response } from 'express';
import { Transaction } from 'sequelize';
import { Setting } from '../models';

type ShippingMethod = {
    code: string;
    name: string;
    fee: number;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
};

const SHIPPING_METHODS_SETTING_KEY = 'shipping_methods';

const DEFAULT_SHIPPING_METHODS: ShippingMethod[] = [
    {
        code: 'kurir_reguler',
        name: 'Kurir Reguler',
        fee: 12000,
        is_active: true,
        sort_order: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    {
        code: 'same_day',
        name: 'Same Day',
        fee: 25000,
        is_active: true,
        sort_order: 20,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    {
        code: 'pickup',
        name: 'Ambil di Toko',
        fee: 0,
        is_active: true,
        sort_order: 30,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }
];

const slugifyCode = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
};

const parseFee = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed < 0) return null;
    return Math.round(parsed);
};

const parseSortOrder = (value: unknown, fallback = 100): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.trunc(parsed));
};

const normalizeMethod = (value: unknown, fallbackSort = 100): ShippingMethod | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;

    const code = slugifyCode(row.code);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const fee = parseFee(row.fee);
    const isActive = row.is_active !== false;
    const sortOrder = parseSortOrder(row.sort_order, fallbackSort);
    const createdAt = typeof row.created_at === 'string' && row.created_at.trim()
        ? row.created_at.trim()
        : new Date().toISOString();
    const updatedAt = typeof row.updated_at === 'string' && row.updated_at.trim()
        ? row.updated_at.trim()
        : new Date().toISOString();

    if (!code || code.length < 2 || code.length > 40) return null;
    if (!name || name.length > 100) return null;
    if (fee === null) return null;

    return {
        code,
        name,
        fee,
        is_active: isActive,
        sort_order: sortOrder,
        created_at: createdAt,
        updated_at: updatedAt
    };
};

const sortMethods = (rows: ShippingMethod[]): ShippingMethod[] => {
    return [...rows].sort((a, b) => {
        const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name || '').localeCompare(String(b.name || ''), 'id');
    });
};

const normalizeMethodsArray = (raw: unknown): ShippingMethod[] => {
    const source = Array.isArray(raw) ? raw : [];
    const dedup = new Map<string, ShippingMethod>();
    source.forEach((item, index) => {
        const normalized = normalizeMethod(item, (index + 1) * 10);
        if (!normalized) return;
        dedup.set(normalized.code, normalized);
    });
    return sortMethods(Array.from(dedup.values()));
};

const getSettingTransaction = async (): Promise<Transaction> => {
    if (!Setting.sequelize) {
        throw new Error('Database connection unavailable');
    }
    return Setting.sequelize.transaction();
};

const loadOrInitMethods = async (options?: {
    transaction?: Transaction;
    lockForUpdate?: boolean;
}): Promise<ShippingMethod[]> => {
    const transaction = options?.transaction;
    const lockForUpdate = options?.lockForUpdate === true;
    const findOptions: any = {};
    if (transaction) {
        findOptions.transaction = transaction;
        if (lockForUpdate) {
            findOptions.lock = transaction.LOCK.UPDATE;
        }
    }

    let existing = await Setting.findByPk(SHIPPING_METHODS_SETTING_KEY, findOptions);
    if (!existing) {
        try {
            await Setting.create({
                key: SHIPPING_METHODS_SETTING_KEY,
                value: DEFAULT_SHIPPING_METHODS,
                description: 'Daftar metode pengiriman dan biayanya'
            }, transaction ? { transaction } : undefined);
        } catch (error: any) {
            if (error?.name !== 'SequelizeUniqueConstraintError') {
                throw error;
            }
        }
        existing = await Setting.findByPk(SHIPPING_METHODS_SETTING_KEY, findOptions);
        if (!existing) {
            throw new Error('Failed to initialize shipping method settings');
        }
    }

    const normalized = normalizeMethodsArray(existing.value);
    if (normalized.length === 0) {
        await existing.update({ value: DEFAULT_SHIPPING_METHODS }, transaction ? { transaction } : undefined);
        return sortMethods(DEFAULT_SHIPPING_METHODS);
    }

    // Keep storage normalized so shape remains consistent.
    if (JSON.stringify(normalized) !== JSON.stringify(existing.value)) {
        await existing.update({ value: normalized }, transaction ? { transaction } : undefined);
    }

    return normalized;
};

const saveMethods = async (methods: ShippingMethod[], transaction?: Transaction) => {
    const sorted = sortMethods(methods);
    const payload = {
        key: SHIPPING_METHODS_SETTING_KEY,
        value: sorted,
        description: 'Daftar metode pengiriman dan biayanya'
    };

    if (transaction) {
        const existing = await Setting.findByPk(SHIPPING_METHODS_SETTING_KEY, {
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
                const row = await Setting.findByPk(SHIPPING_METHODS_SETTING_KEY, {
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

export const getShippingMethods = async (req: Request, res: Response) => {
    try {
        const activeOnly = String(req.query.active_only || '').trim() === 'true';
        const methods = await loadOrInitMethods();
        const rows = activeOnly ? methods.filter((item) => item.is_active) : methods;
        return res.json({ shipping_methods: rows });
    } catch (error) {
        return res.status(500).json({ message: 'Gagal memuat metode pengiriman', error });
    }
};

export const createShippingMethod = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const methods = await loadOrInitMethods({ transaction: t, lockForUpdate: true });

        const code = slugifyCode(req.body?.code || req.body?.name);
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const fee = parseFee(req.body?.fee);
        const isActive = req.body?.is_active !== false;
        const sortOrder = parseSortOrder(req.body?.sort_order, (methods.length + 1) * 10);

        if (!code || code.length < 2 || code.length > 40) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode metode tidak valid (2-40 karakter).' });
        }
        if (!name || name.length > 100) {
            await t.rollback();
            return res.status(400).json({ message: 'Nama metode wajib diisi (maks. 100 karakter).' });
        }
        if (fee === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Biaya pengiriman tidak valid.' });
        }
        if (methods.some((item) => item.code === code)) {
            await t.rollback();
            return res.status(409).json({ message: 'Kode metode pengiriman sudah digunakan.' });
        }

        const now = new Date().toISOString();
        const created: ShippingMethod = {
            code,
            name,
            fee,
            is_active: isActive,
            sort_order: sortOrder,
            created_at: now,
            updated_at: now,
        };

        const saved = await saveMethods([...methods, created], t);
        await t.commit();
        return res.status(201).json({
            message: 'Metode pengiriman berhasil ditambahkan.',
            shipping_methods: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal menambahkan metode pengiriman', error });
    }
};

export const updateShippingMethod = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const code = slugifyCode(req.params.code);
        if (!code) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode metode tidak valid.' });
        }

        const methods = await loadOrInitMethods({ transaction: t, lockForUpdate: true });
        const idx = methods.findIndex((item) => item.code === code);
        if (idx < 0) {
            await t.rollback();
            return res.status(404).json({ message: 'Metode pengiriman tidak ditemukan.' });
        }

        const current = methods[idx];
        const nextName = typeof req.body?.name === 'string' ? req.body.name.trim() : current.name;
        const parsedFee = req.body?.fee !== undefined ? parseFee(req.body.fee) : current.fee;
        const nextFee = parsedFee;
        const nextIsActive = req.body?.is_active !== undefined ? req.body.is_active !== false : current.is_active;
        const nextSortOrder = req.body?.sort_order !== undefined
            ? parseSortOrder(req.body.sort_order, current.sort_order)
            : current.sort_order;

        if (!nextName || nextName.length > 100) {
            await t.rollback();
            return res.status(400).json({ message: 'Nama metode tidak valid.' });
        }
        if (nextFee === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Biaya pengiriman tidak valid.' });
        }

        const nextRows = [...methods];
        nextRows[idx] = {
            ...current,
            name: nextName,
            fee: nextFee,
            is_active: nextIsActive,
            sort_order: nextSortOrder,
            updated_at: new Date().toISOString()
        };

        const activeCount = nextRows.filter((item) => item.is_active).length;
        if (activeCount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Minimal harus ada 1 metode pengiriman aktif.' });
        }

        const saved = await saveMethods(nextRows, t);
        await t.commit();
        return res.json({
            message: 'Metode pengiriman berhasil diperbarui.',
            shipping_methods: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal memperbarui metode pengiriman', error });
    }
};

export const removeShippingMethod = async (req: Request, res: Response) => {
    const t = await getSettingTransaction();
    try {
        const code = slugifyCode(req.params.code);
        if (!code) {
            await t.rollback();
            return res.status(400).json({ message: 'Kode metode tidak valid.' });
        }

        const methods = await loadOrInitMethods({ transaction: t, lockForUpdate: true });
        const exists = methods.some((item) => item.code === code);
        if (!exists) {
            await t.rollback();
            return res.status(404).json({ message: 'Metode pengiriman tidak ditemukan.' });
        }

        const nextRows = methods.filter((item) => item.code !== code);
        if (nextRows.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak bisa menghapus semua metode pengiriman.' });
        }
        if (nextRows.filter((item) => item.is_active).length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Minimal harus ada 1 metode pengiriman aktif.' });
        }

        const saved = await saveMethods(nextRows, t);
        await t.commit();
        return res.json({
            message: 'Metode pengiriman berhasil dihapus.',
            shipping_methods: saved
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal menghapus metode pengiriman', error });
    }
};

export const resolveShippingMethodByCode = async (codeRaw: unknown): Promise<ShippingMethod | null> => {
    const code = slugifyCode(codeRaw);
    if (!code) return null;
    const methods = await loadOrInitMethods();
    return methods.find((item) => item.code === code && item.is_active) || null;
};
