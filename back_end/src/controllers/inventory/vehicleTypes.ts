import { Request, Response } from 'express';
import { Op, Transaction } from 'sequelize';
import { Product, Setting, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import {
    VEHICLE_TYPES_SETTING_KEY,
    buildCanonicalVehicleMap,
    canonicalizeVehicleList,
    dedupeCaseInsensitive,
    normalizeVehicleToken,
    parseVehicleCompatibilityDbString,
    toVehicleCompatibilityDbValue
} from '../../utils/vehicleCompatibility';

const readVehicleTypeOptions = (setting: Setting | null): string[] => {
    const value = setting?.value;
    if (Array.isArray(value)) {
        return dedupeCaseInsensitive(value.map((item) => normalizeVehicleToken(String(item ?? ''))));
    }
    return [];
};

const upsertVehicleTypeOptions = async (options: string[], transaction: Transaction) => {
    const deduped = dedupeCaseInsensitive(options);
    await Setting.upsert(
        {
            key: VEHICLE_TYPES_SETTING_KEY,
            value: deduped,
            description: 'Master list aplikasi/jenis kendaraan untuk field products.vehicle_compatibility'
        },
        { transaction }
    );
    return deduped;
};

const withVehicleTypesLock = async <T>(fn: (args: { transaction: Transaction; options: string[] }) => Promise<T>) => {
    const transaction = await sequelize.transaction();
    try {
        const setting = await Setting.findByPk(VEHICLE_TYPES_SETTING_KEY, {
            transaction,
            lock: transaction.LOCK.UPDATE
        });
        const options = readVehicleTypeOptions(setting);
        const result = await fn({ transaction, options });
        await transaction.commit();
        return result;
    } catch (error) {
        try { await transaction.rollback(); } catch { }
        throw error;
    }
};

export const getVehicleTypes = asyncWrapper(async (_req: Request, res: Response) => {
    const setting = await Setting.findByPk(VEHICLE_TYPES_SETTING_KEY);
    const options = readVehicleTypeOptions(setting);
    return res.json({ options });
});

export const createVehicleType = asyncWrapper(async (req: Request, res: Response) => {
    const name = normalizeVehicleToken(String(req.body?.name ?? ''));
    if (!name) throw new CustomError('name wajib diisi', 400);

    const result = await withVehicleTypesLock(async ({ transaction, options }) => {
        const next = dedupeCaseInsensitive([...options, name]);
        const saved = await upsertVehicleTypeOptions(next, transaction);
        return { options: saved };
    });

    return res.status(201).json(result);
});

export const renameVehicleType = asyncWrapper(async (req: Request, res: Response) => {
    const from = normalizeVehicleToken(String(req.body?.from ?? ''));
    const to = normalizeVehicleToken(String(req.body?.to ?? ''));
    if (!from) throw new CustomError('from wajib diisi', 400);
    if (!to) throw new CustomError('to wajib diisi', 400);

    const result = await withVehicleTypesLock(async ({ transaction, options }) => {
        const map = buildCanonicalVehicleMap(options);
        const fromKey = from.toLowerCase();
        const toKey = to.toLowerCase();
        const existsFrom = map.has(fromKey);
        if (!existsFrom) throw new CustomError('Jenis kendaraan asal tidak ditemukan', 404);

        const merged = options
            .filter((item) => normalizeVehicleToken(item).toLowerCase() !== fromKey)
            .concat([to]);
        const savedOptions = await upsertVehicleTypeOptions(merged, transaction);
        const canonicalMap = buildCanonicalVehicleMap(savedOptions);
        const toCanonical = canonicalMap.get(toKey) || to;

        const likeNeedle = `%${from.replace(/[%_]/g, '\\$&')}%`;
        const candidates = await Product.findAll({
            where: {
                vehicle_compatibility: {
                    [Op.like]: likeNeedle
                }
            },
            attributes: ['id', 'vehicle_compatibility'],
            transaction,
            lock: transaction.LOCK.UPDATE
        });

        let migrated = 0;
        for (const product of candidates) {
            const tokens = parseVehicleCompatibilityDbString(product.vehicle_compatibility);
            if (tokens.length === 0) continue;

            const replaced = tokens.map((token) => (normalizeVehicleToken(token).toLowerCase() === fromKey ? toCanonical : token));
            const { canonical, unknown } = canonicalizeVehicleList(replaced, canonicalMap);
            // Migration path: keep any unknowns as-is to avoid data loss; they can be cleaned later.
            const nextTokens = dedupeCaseInsensitive([...canonical, ...unknown]);
            const nextValue = toVehicleCompatibilityDbValue(nextTokens);
            if (nextValue !== product.vehicle_compatibility) {
                await Product.update(
                    { vehicle_compatibility: nextValue },
                    { where: { id: product.id }, transaction }
                );
                migrated += 1;
            }
        }

        return { options: savedOptions, migrated_products: migrated };
    });

    return res.json(result);
});

const countProductsUsingType = async (name: string, transaction: Transaction) => {
    const key = normalizeVehicleToken(name).toLowerCase();
    if (!key) return 0;
    const likeNeedle = `%${name.replace(/[%_]/g, '\\$&')}%`;
    const candidates = await Product.findAll({
        where: {
            vehicle_compatibility: {
                [Op.like]: likeNeedle
            }
        },
        attributes: ['vehicle_compatibility'],
        transaction
    });

    let count = 0;
    for (const product of candidates) {
        const tokens = parseVehicleCompatibilityDbString(product.vehicle_compatibility);
        if (tokens.some((token) => normalizeVehicleToken(token).toLowerCase() === key)) count += 1;
    }
    return count;
};

export const deleteVehicleType = asyncWrapper(async (req: Request, res: Response) => {
    const name = normalizeVehicleToken(String(req.body?.name ?? ''));
    const replacement = normalizeVehicleToken(String(req.body?.replacement ?? '')) || null;
    if (!name) throw new CustomError('name wajib diisi', 400);

    const result = await withVehicleTypesLock(async ({ transaction, options }) => {
        const canonicalMapBefore = buildCanonicalVehicleMap(options);
        const nameKey = name.toLowerCase();
        if (!canonicalMapBefore.has(nameKey)) throw new CustomError('Jenis kendaraan tidak ditemukan', 404);

        const usedCount = await countProductsUsingType(name, transaction);
        if (usedCount > 0 && !replacement) {
            throw new CustomError(`Jenis kendaraan masih dipakai ${usedCount} produk. Isi replacement untuk melanjutkan hapus.`, 409);
        }
        if (replacement) {
            const replacementKey = replacement.toLowerCase();
            if (replacementKey === nameKey) throw new CustomError('replacement tidak boleh sama dengan name', 400);

            // Ensure replacement exists in master list.
            const merged = dedupeCaseInsensitive([...options, replacement]).filter((item) => normalizeVehicleToken(item).toLowerCase() !== nameKey);
            const savedOptions = await upsertVehicleTypeOptions(merged, transaction);
            const canonicalMap = buildCanonicalVehicleMap(savedOptions);
            const replacementCanonical = canonicalMap.get(replacementKey) || replacement;

            const likeNeedle = `%${name.replace(/[%_]/g, '\\$&')}%`;
            const candidates = await Product.findAll({
                where: {
                    vehicle_compatibility: {
                        [Op.like]: likeNeedle
                    }
                },
                attributes: ['id', 'vehicle_compatibility'],
                transaction,
                lock: transaction.LOCK.UPDATE
            });

            let migrated = 0;
            for (const product of candidates) {
                const tokens = parseVehicleCompatibilityDbString(product.vehicle_compatibility);
                if (tokens.length === 0) continue;
                if (!tokens.some((token) => normalizeVehicleToken(token).toLowerCase() === nameKey)) continue;

                const replaced = tokens
                    .filter((token) => normalizeVehicleToken(token).toLowerCase() !== nameKey)
                    .concat([replacementCanonical]);
                const { canonical, unknown } = canonicalizeVehicleList(replaced, canonicalMap);
                const nextTokens = dedupeCaseInsensitive([...canonical, ...unknown]);
                const nextValue = toVehicleCompatibilityDbValue(nextTokens);
                await Product.update({ vehicle_compatibility: nextValue }, { where: { id: product.id }, transaction });
                migrated += 1;
            }

            return { options: savedOptions, migrated_products: migrated };
        }

        // Not used; safe delete.
        const savedOptions = await upsertVehicleTypeOptions(
            options.filter((item) => normalizeVehicleToken(item).toLowerCase() !== nameKey),
            transaction
        );
        return { options: savedOptions, migrated_products: 0 };
    });

    return res.json(result);
});

