import { Request, Response } from 'express';
import { Product, ProductAlias, sequelize } from '../../models';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { normalizeAliasInput } from '../../utils/productSearch';

const MAX_ALIASES_PER_PRODUCT = 30;
const MAX_ALIAS_LENGTH = 60;
const DIGIT_REGEX = /\d/;

export const getProductAliases = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.id || '').trim();
    if (!productId) {
        throw new CustomError('product id tidak valid', 400);
    }

    const product = await Product.findByPk(productId);
    if (!product) {
        throw new CustomError('Product tidak ditemukan', 404);
    }

    const rows = await ProductAlias.findAll({
        where: { product_id: productId },
        attributes: ['alias'],
        order: [['alias', 'ASC']]
    });

    res.json({ aliases: rows.map((row: any) => String(row.alias || '').trim()).filter(Boolean) });
});

export const putProductAliases = asyncWrapper(async (req: Request, res: Response) => {
    const productId = String(req.params.id || '').trim();
    if (!productId) {
        throw new CustomError('product id tidak valid', 400);
    }

    const rawAliases = (req.body as any)?.aliases;
    if (!Array.isArray(rawAliases)) {
        throw new CustomError('aliases harus berupa array string', 400);
    }

    const normalizedEntries = rawAliases
        .map((value: unknown) => normalizeAliasInput(value))
        .filter(Boolean) as Array<{ alias: string; alias_normalized: string }>;

    const uniqueByNormalized = new Map<string, { alias: string; alias_normalized: string }>();
    for (const entry of normalizedEntries) {
        const alias = entry.alias.trim();
        if (alias.length > MAX_ALIAS_LENGTH) {
            throw new CustomError(`Alias terlalu panjang (maks ${MAX_ALIAS_LENGTH} karakter): ${alias.slice(0, 24)}...`, 400);
        }

        const normalized = entry.alias_normalized;
        if (normalized.length < 2 && !DIGIT_REGEX.test(normalized)) {
            continue;
        }

        if (!uniqueByNormalized.has(normalized)) {
            uniqueByNormalized.set(normalized, { alias, alias_normalized: normalized });
        }
    }

    const aliases = Array.from(uniqueByNormalized.values());
    if (aliases.length > MAX_ALIASES_PER_PRODUCT) {
        throw new CustomError(`Terlalu banyak alias (maks ${MAX_ALIASES_PER_PRODUCT} per produk)`, 400);
    }

    const t = await sequelize.transaction();
    try {
        const product = await Product.findByPk(productId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!product) {
            await t.rollback();
            throw new CustomError('Product tidak ditemukan', 404);
        }

        await ProductAlias.destroy({ where: { product_id: productId }, transaction: t });
        if (aliases.length > 0) {
            await ProductAlias.bulkCreate(
                aliases.map((row) => ({
                    product_id: productId,
                    alias: row.alias,
                    alias_normalized: row.alias_normalized,
                })),
                { transaction: t }
            );
        }

        await t.commit();
        return res.json({ aliases: aliases.map((row) => row.alias) });
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
});

