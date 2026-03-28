import { Request, Response } from 'express';
import { Product, Category, ProductCategory, sequelize } from '../models';
import { Op, fn, col } from 'sequelize';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { applyTokenSearch, buildProductMatchCountLiteral, getCountNumber, splitSearchTokens } from '../utils/productSearch';

// Public Catalog API - Safe for Customers (Hides base_price/COGS)

export const getCatalog = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 12, search, category_id, min_price, max_price, sort } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = { status: 'active' };

        if (category_id) {
            const categoryId = Number(category_id);
            if (!Number.isInteger(categoryId) || categoryId <= 0) {
                throw new CustomError('category_id tidak valid', 400);
            }

            const mappings = await ProductCategory.findAll({
                attributes: ['product_id'],
                where: { category_id: categoryId },
                raw: true
            });
            const mappedProductIds = mappings.map((item: any) => item.product_id);

            const categoryMatcher: any = {
                [Op.or]: [
                    { category_id: categoryId },
                    ...(mappedProductIds.length > 0 ? [{ id: { [Op.in]: mappedProductIds } }] : [])
                ]
            };
            whereClause[Op.and] = [...(whereClause[Op.and] || []), categoryMatcher];
        }

        if (min_price || max_price) {
            whereClause.price = {};
            if (min_price) whereClause.price[Op.gte] = min_price;
            if (max_price) whereClause.price[Op.lte] = max_price;
        }

        let order: any = [['name', 'ASC']];
        if (sort === 'price_asc') order = [['price', 'ASC']];
        if (sort === 'price_desc') order = [['price', 'DESC']];
        if (sort === 'newest') order = [['createdAt', 'DESC']];

        const tokens = splitSearchTokens(search);
        const matchCountLiteral = tokens.length > 0
            ? buildProductMatchCountLiteral({ sequelize, tokens, productTableAlias: 'Product' })
            : null;
        const buildSearchWhere = (mode: 'and' | 'or') => {
            const next: any = { ...whereClause };
            const andVal = next[Op.and];
            if (Array.isArray(andVal)) next[Op.and] = [...andVal];
            applyTokenSearch({ sequelize, whereClause: next, tokens, mode, productTableAlias: 'Product' });
            return next;
        };

        const tokensPresent = tokens.length > 0;
        const orderForSearch = tokensPresent
            ? [
                ...(matchCountLiteral ? [[matchCountLiteral, 'DESC'] as any] : []),
                ...order
            ]
            : order;

        const runQuery = async (mode: 'and' | 'or') => {
            const whereForQuery = tokensPresent ? buildSearchWhere(mode) : whereClause;
            const productAttributes = [
                'id',
                'sku',
                'name',
                'price',
                'unit',
                'description',
                'image_url',
                'category_id',
                ...(tokensPresent ? (['barcode'] as const) : []),
            ];
            return Product.findAndCountAll({
                where: whereForQuery,
                attributes: productAttributes, // Explicit attributes (hide stock from public)
                include: [
                    { model: Category, attributes: ['id', 'name', 'icon'] },
                    { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
                ],
                limit: Number(limit),
                offset: Number(offset),
                order: orderForSearch,
                distinct: true
            });
        };

        const buildSimpleSearchWhere = (mode: 'and' | 'or') => {
            const next: any = { ...whereClause };
            const andVal = next[Op.and];
            if (Array.isArray(andVal)) next[Op.and] = [...andVal];

            const tokenClauses = tokens.map((token) => ({
                [Op.or]: [
                    { name: { [Op.like]: `%${token}%` } },
                    { sku: { [Op.like]: `%${token}%` } },
                    { barcode: { [Op.like]: `%${token}%` } },
                ]
            }));

            const existing = next[Op.and];
            const andParts: any[] = [];
            if (Array.isArray(existing)) andParts.push(...existing);
            else if (existing) andParts.push(existing);

            if (mode === 'and') {
                andParts.push(...tokenClauses);
            } else {
                andParts.push({ [Op.or]: tokenClauses });
            }
            next[Op.and] = andParts;
            return next;
        };

        const runSimpleQuery = async (mode: 'and' | 'or') => {
            const whereForQuery = tokensPresent ? buildSimpleSearchWhere(mode) : whereClause;
            const productAttributes = [
                'id',
                'sku',
                'name',
                'price',
                'unit',
                'description',
                'image_url',
                'category_id',
            ];
            return Product.findAndCountAll({
                where: whereForQuery,
                attributes: productAttributes,
                include: [
                    { model: Category, attributes: ['id', 'name', 'icon'] },
                    { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
                ],
                limit: Number(limit),
                offset: Number(offset),
                order: tokensPresent
                    ? order
                    : order,
                distinct: true
            });
        };

        let result;
        try {
            result = await runQuery('and');
        } catch (error: any) {
            if (!tokensPresent) throw error;
            console.error('[Catalog] Advanced search failed; fallback to basic token search.', error);
            result = await runSimpleQuery('and');
        }

        if (tokens.length > 1 && getCountNumber((result as any)?.count) === 0) {
            try {
                result = await runQuery('or');
            } catch (error: any) {
                console.error('[Catalog] Advanced OR search failed; fallback to basic token search.', error);
                result = await runSimpleQuery('or');
            }
        }

        const { count, rows } = result;

        const safeRows = tokensPresent
            ? (rows as any[]).map((row) => {
                const plain = typeof (row as any)?.get === 'function' ? (row as any).get({ plain: true }) : row;
                if (plain && typeof plain === 'object' && 'barcode' in plain) {
                    delete (plain as any).barcode;
                }
                return plain;
            })
            : rows;

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            products: safeRows
        });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching catalog', 500);
    }
});

export const getProductDetails = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { id } = req.params; // Can be UUID or SKU? 
        // Route says usually /products/:id or /products/:slug
        // Let's support UUID or SKU if possible, or just UUID.
        // Frontend likely uses UUID from list.
        // But for SEO, SKU or Slug is better. 
        // Let's assume ID for now.

        const product = await Product.findOne({
            where: {
                [Op.or]: [{ id }, { sku: id }], // Friendly URL support
                status: 'active'
            },
            attributes: ['id', 'sku', 'name', 'price', 'unit', 'description', 'image_url', 'category_id'],
            include: [
                { model: Category, attributes: ['id', 'name', 'icon'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
            ]
        });

        if (!product) {
            throw new CustomError('Product not found', 404);
        }

        res.json(product);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching product', 500);
    }
});

export const getPublicCategories = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const limitRaw = Number(req.query.limit ?? 6);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 20) : 6;

        const popularityRows = await Product.findAll({
            attributes: [
                'category_id',
                [fn('COUNT', col('id')), 'product_count']
            ],
            where: { status: 'active' },
            group: ['category_id'],
            order: [[fn('COUNT', col('id')), 'DESC']],
            limit,
            raw: true
        }) as unknown as Array<{ category_id: number; product_count: number }>;

        const categoryIds = popularityRows
            .map((row) => Number(row.category_id))
            .filter((value) => Number.isInteger(value) && value > 0);

        if (categoryIds.length === 0) {
            const fallback = await Category.findAll({
                attributes: ['id', 'name', 'description', 'icon'],
                order: [['name', 'ASC']],
                limit
            });
            return res.json({ categories: fallback });
        }

        const categories = await Category.findAll({
            attributes: ['id', 'name', 'description', 'icon'],
            where: { id: { [Op.in]: categoryIds } }
        });

        const categoryMap = new Map<number, any>();
        categories.forEach((category) => categoryMap.set(Number(category.id), category));
        const sorted = categoryIds
            .map((id) => categoryMap.get(id))
            .filter(Boolean);

        res.json({ categories: sorted });
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching public categories', 500);
    }
});
