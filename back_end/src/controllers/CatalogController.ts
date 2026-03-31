import { Request, Response } from 'express';
import { Product, Category, ProductCategory, CustomerProfile, sequelize } from '../models';
import { Op, fn, col } from 'sequelize';
import { asyncWrapper } from '../utils/asyncWrapper';
import { CustomError } from '../utils/CustomError';
import { applyTokenSearch, buildProductMatchCountLiteral, getCountNumber, splitSearchTokens } from '../utils/productSearch';
import { resolveEffectiveTierPricing } from './order/utils';

// Public Catalog API - Safe for Customers (Hides base_price/COGS)

export const getCatalog = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 12, search, category_id, min_price, max_price, sort, featured } = req.query;
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

        const featuredMode = String(featured ?? '').trim().toLowerCase();
        const shouldComputeTierPricing = String(req.user?.role || '') === 'customer' && Boolean(req.user?.id);
        const userTier = shouldComputeTierPricing
            ? (await CustomerProfile.findByPk(String(req.user!.id), { attributes: ['tier'] }))?.tier || 'regular'
            : null;

        const nameOrder: any = ['name', 'ASC'];
        // Qualify with the Product table alias to avoid ambiguity once Sequelize adds joins/subqueries.
        const stockDescOrder: any = [sequelize.literal('COALESCE(`Product`.`stock_quantity`, 0)'), 'DESC'];
        const stockAscOrder: any = [sequelize.literal('COALESCE(`Product`.`stock_quantity`, 0)'), 'ASC'];

        let order: any = [nameOrder];
        if (sort === 'price_asc') order = [['price', 'ASC'], nameOrder];
        if (sort === 'price_desc') order = [['price', 'DESC'], nameOrder];
        if (sort === 'newest') order = [['createdAt', 'DESC'], nameOrder];
        if (sort === 'stock_desc') order = [stockDescOrder, nameOrder];
        if (sort === 'stock_asc') order = [stockAscOrder, nameOrder];

        const tokens = splitSearchTokens(search);

        if (featuredMode === 'home' && tokens.length === 0) {
            const limitRaw = Number(limit);
            const safeLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.trunc(limitRaw), 60) : 12;

            const include = [
                { model: Category, attributes: ['id', 'name', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
            ];
            const attributes = [
                'id',
                'sku',
                'name',
                'price',
                'varian_harga',
                'unit',
                'description',
                'image_url',
                'category_id',
            ];

            const total = await Product.count({ where: whereClause });

            let featuredRows: any[] = [];

            const initialRows = await Product.findAll({
                where: whereClause,
                attributes: [...attributes, 'stock_quantity'],
                include,
                order: [stockDescOrder, nameOrder],
                limit: safeLimit
            });

            if (initialRows.length === 0) {
                featuredRows = [];
            } else {
                const headStock = Number((initialRows[0] as any)?.get?.('stock_quantity') ?? (initialRows[0] as any)?.stock_quantity ?? 0);

                if (!Number.isFinite(headStock) || headStock <= 0) {
                    featuredRows = await Product.findAll({
                        where: whereClause,
                        attributes,
                        include,
                        order: sequelize.literal('RAND()') as any,
                        limit: safeLimit
                    });
                } else {
                    const restAllZero = initialRows.slice(1).every((row) => {
                        const v = Number((row as any)?.get?.('stock_quantity') ?? (row as any)?.stock_quantity ?? 0);
                        return !Number.isFinite(v) || v <= 0;
                    });

                    if (restAllZero && safeLimit > 1) {
                        const head = initialRows[0];
                        const headId = (head as any)?.id;
                        const excludeWhere = headId ? { id: { [Op.notIn]: [headId] } } : {};
                        const randomRows = await Product.findAll({
                            where: { ...whereClause, ...excludeWhere },
                            attributes,
                            include,
                            order: sequelize.literal('RAND()') as any,
                            limit: safeLimit - 1
                        });
                        featuredRows = [head, ...randomRows];
                    } else {
                        featuredRows = initialRows;
                    }
                }
            }

            const safeRows = featuredRows.map((row) => {
                const plain = typeof (row as any)?.get === 'function' ? (row as any).get({ plain: true }) : row;
                if (plain && typeof plain === 'object') {
                    const record = plain as any;
                    if ('barcode' in record) delete record.barcode;
                    if ('stock_quantity' in record) delete record.stock_quantity;

                    if (userTier) {
                        const basePrice = Number(record.price || 0);
                        const pricing = resolveEffectiveTierPricing(basePrice, String(userTier || 'regular'), record.varian_harga, record.Category);
                        record.effective_tier = String(userTier || 'regular');
                        record.effective_price = pricing.finalPrice;
                        record.effective_discount_pct = pricing.discountPct;
                        record.effective_discount_source = pricing.discountSource;
                    }

                    // Never expose internal pricing structures in public responses.
                    if ('varian_harga' in record) delete record.varian_harga;
                    if (record.Category && typeof record.Category === 'object') {
                        delete record.Category.discount_regular_pct;
                        delete record.Category.discount_gold_pct;
                        delete record.Category.discount_premium_pct;
                    }
                }
                return plain;
            });

            res.json({
                total,
                totalPages: safeLimit > 0 ? Math.ceil(total / safeLimit) : 0,
                currentPage: 1,
                products: safeRows
            });
            return;
        }

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
        const isStockSort = sort === 'stock_desc' || sort === 'stock_asc';
        // When sorting by stock, Sequelize may push ORDER BY to an outer query (derived table),
        // which requires the ordered column to be part of the SELECT list. We include it but
        // strip it from the public response below.
        const includeStockForOrdering = isStockSort;
        const stockOrderForSearch = sort === 'stock_desc' ? stockDescOrder : sort === 'stock_asc' ? stockAscOrder : null;
        const orderForSearch = tokensPresent
            ? (isStockSort
                ? [
                    ...(stockOrderForSearch ? [stockOrderForSearch] : []),
                    ...(matchCountLiteral ? [[matchCountLiteral, 'DESC'] as any] : []),
                    nameOrder
                ]
                : [
                    ...(matchCountLiteral ? [[matchCountLiteral, 'DESC'] as any] : []),
                    ...order
                ])
            : order;

        const runQuery = async (mode: 'and' | 'or') => {
            const whereForQuery = tokensPresent ? buildSearchWhere(mode) : whereClause;
            const productAttributes = [
                'id',
                'sku',
                'name',
                'price',
                'varian_harga',
                'unit',
                'description',
                'image_url',
                'category_id',
                ...(includeStockForOrdering ? (['stock_quantity'] as const) : []),
                ...(tokensPresent ? (['barcode'] as const) : []),
            ];
            return Product.findAndCountAll({
                where: whereForQuery,
                attributes: productAttributes, // Explicit attributes (hide stock from public)
                include: [
                    { model: Category, attributes: ['id', 'name', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'] },
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
                'varian_harga',
                'unit',
                'description',
                'image_url',
                'category_id',
                ...(includeStockForOrdering ? (['stock_quantity'] as const) : []),
            ];
            return Product.findAndCountAll({
                where: whereForQuery,
                attributes: productAttributes,
                include: [
                    { model: Category, attributes: ['id', 'name', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'] },
                    { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
                ],
                limit: Number(limit),
                offset: Number(offset),
                order,
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

        const safeRows = (rows as any[]).map((row) => {
            const plain = typeof (row as any)?.get === 'function' ? (row as any).get({ plain: true }) : row;
            if (plain && typeof plain === 'object') {
                const record = plain as any;
                if ('barcode' in record) delete record.barcode;
                if ('stock_quantity' in record) delete record.stock_quantity;

                if (userTier) {
                    const basePrice = Number(record.price || 0);
                    const pricing = resolveEffectiveTierPricing(basePrice, String(userTier || 'regular'), record.varian_harga, record.Category);
                    record.effective_tier = String(userTier || 'regular');
                    record.effective_price = pricing.finalPrice;
                    record.effective_discount_pct = pricing.discountPct;
                    record.effective_discount_source = pricing.discountSource;
                }

                if ('varian_harga' in record) delete record.varian_harga;
                if (record.Category && typeof record.Category === 'object') {
                    delete record.Category.discount_regular_pct;
                    delete record.Category.discount_gold_pct;
                    delete record.Category.discount_premium_pct;
                }
            }
            return plain;
        });

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

        // Keep production responses stable, but don't hide the real error in development.
        if (process.env.NODE_ENV === 'production') {
            throw new CustomError('Error fetching catalog', 500);
        }

        throw error;
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

        const shouldComputeTierPricing = String(req.user?.role || '') === 'customer' && Boolean(req.user?.id);
        const userTier = shouldComputeTierPricing
            ? (await CustomerProfile.findByPk(String(req.user!.id), { attributes: ['tier'] }))?.tier || 'regular'
            : null;

        const product = await Product.findOne({
            where: {
                [Op.or]: [{ id }, { sku: id }], // Friendly URL support
                status: 'active'
            },
            attributes: ['id', 'sku', 'name', 'price', 'varian_harga', 'unit', 'description', 'image_url', 'category_id'],
            include: [
                { model: Category, attributes: ['id', 'name', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
            ]
        });

        if (!product) {
            throw new CustomError('Product not found', 404);
        }

        const plain = typeof (product as any)?.get === 'function' ? (product as any).get({ plain: true }) : product;
        if (plain && typeof plain === 'object') {
            const record = plain as any;
            if (userTier) {
                const basePrice = Number(record.price || 0);
                const pricing = resolveEffectiveTierPricing(basePrice, String(userTier || 'regular'), record.varian_harga, record.Category);
                record.effective_tier = String(userTier || 'regular');
                record.effective_price = pricing.finalPrice;
                record.effective_discount_pct = pricing.discountPct;
                record.effective_discount_source = pricing.discountSource;
            }

            if ('varian_harga' in record) delete record.varian_harga;
            if (record.Category && typeof record.Category === 'object') {
                delete record.Category.discount_regular_pct;
                delete record.Category.discount_gold_pct;
                delete record.Category.discount_premium_pct;
            }
        }

        res.json(plain);
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
