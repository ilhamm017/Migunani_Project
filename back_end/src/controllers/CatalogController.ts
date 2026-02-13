import { Request, Response } from 'express';
import { Product, Category, ProductCategory } from '../models';
import { Op, fn, col } from 'sequelize';

// Public Catalog API - Safe for Customers (Hides base_price/COGS)

export const getCatalog = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 12, search, category_id, min_price, max_price, sort } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = { status: 'active' };

        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                // Maybe descriptive tags?
            ];
        }

        if (category_id) {
            const categoryId = Number(category_id);
            if (!Number.isInteger(categoryId) || categoryId <= 0) {
                return res.status(400).json({ message: 'category_id tidak valid' });
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

        const { count, rows } = await Product.findAndCountAll({
            where: whereClause,
            attributes: ['id', 'sku', 'name', 'price', 'unit', 'description', 'image_url', 'stock_quantity', 'category_id'], // Explicit attributes
            include: [
                { model: Category, attributes: ['id', 'name', 'icon'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order,
            distinct: true
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            products: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching catalog', error });
    }
};

export const getProductDetails = async (req: Request, res: Response) => {
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
            attributes: ['id', 'sku', 'name', 'price', 'unit', 'description', 'image_url', 'stock_quantity', 'category_id'],
            include: [
                { model: Category, attributes: ['id', 'name', 'icon'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name', 'icon'], through: { attributes: [] }, required: false }
            ]
        });

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product', error });
    }
};

export const getPublicCategories = async (req: Request, res: Response) => {
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
        res.status(500).json({ message: 'Error fetching public categories', error });
    }
};
