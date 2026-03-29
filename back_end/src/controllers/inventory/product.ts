import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine, Setting } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction, UniqueConstraintError, ValidationError, col, where } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { syncProductCategories, toObjectOrEmpty, ensureProductColumnsReady, PRODUCT_IMAGE_MAX_SIZE_BYTES, toPercentageNumber, ALLOWED_PRODUCT_IMAGE_MIME_TYPES, toNonNegativeNumber, roundPrice, readCellText, resolveProductImageExtension } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';
import { VEHICLE_TYPES_SETTING_KEY, buildCanonicalVehicleMap, canonicalizeVehicleList, parseVehicleCompatibilityInput, toVehicleCompatibilityDbValue } from '../../utils/vehicleCompatibility';
import { applyTokenSearch, buildProductMatchCountLiteral, getCountNumber, splitSearchTokens } from '../../utils/productSearch';

export const getProducts = asyncWrapper(async (req: Request, res: Response) => {
    try {
        await ensureProductColumnsReady();

        const { page = 1, limit = 10, search, category_id, status = 'all', stock_filter = 'all', sort_by } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const normalizedSortBy = String(sort_by ?? '').trim().toLowerCase();

        const whereClause: any = {};
        const normalizedStatus = String(status).toLowerCase();
        if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
            whereClause.status = normalizedStatus;
        }

        const normalizedStockFilter = String(stock_filter ?? 'all').toLowerCase();
        if (!['all', 'empty', 'low'].includes(normalizedStockFilter)) {
            throw new CustomError('stock_filter tidak valid (gunakan: all|empty|low)', 400);
        }

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

        const normalizedPage = Math.max(1, Number(page) || 1);
        const normalizedLimit = Math.max(1, Number(limit) || 10);

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

        const runQuery = async (searchMode: 'and' | 'or') => {
            const whereForQuery = tokens.length > 0 ? buildSearchWhere(searchMode) : whereClause;

            const buildWhereWithAndFrom = (source: any, extras: any[]) => {
                const next: any = { ...source };
                const existing = next[Op.and];
                const andParts: any[] = [];
                if (Array.isArray(existing)) andParts.push(...existing);
                else if (existing) andParts.push(existing);
                andParts.push(...extras);
                next[Op.and] = andParts;
                return next;
            };

            const listWhere = (() => {
                if (normalizedStockFilter === 'empty') {
                    return buildWhereWithAndFrom(whereForQuery, [{ stock_quantity: { [Op.lte]: 0 } }]);
                }
                if (normalizedStockFilter === 'low') {
                    return buildWhereWithAndFrom(whereForQuery, [
                        { stock_quantity: { [Op.gt]: 0 } },
                        where(col('stock_quantity'), Op.lte, col('min_stock'))
                    ]);
                }
                return whereForQuery;
            })();

            const [listResult, emptyStockCount, lowStockCount] = await Promise.all([
                Product.findAndCountAll({
                    where: listWhere,
                    include: [
                        { model: Category, attributes: ['id', 'name'] },
                        { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
                    ],
                    limit: normalizedLimit,
                    offset: (normalizedPage - 1) * normalizedLimit,
                    order: (() => {
                        if (normalizedSortBy === 'stock_desc') {
                            const orderParts: any[] = [['stock_quantity', 'DESC']];
                            if (matchCountLiteral) orderParts.push([matchCountLiteral, 'DESC']);
                            orderParts.push(['name', 'ASC']);
                            return orderParts;
                        }
                        if (normalizedSortBy === 'stock_asc') {
                            const orderParts: any[] = [['stock_quantity', 'ASC']];
                            if (matchCountLiteral) orderParts.push([matchCountLiteral, 'DESC']);
                            orderParts.push(['name', 'ASC']);
                            return orderParts;
                        }
                        return matchCountLiteral
                            ? [[matchCountLiteral, 'DESC'], ['name', 'ASC']]
                            : [['name', 'ASC']];
                    })(),
                    distinct: true
                }),
                Product.count({
                    where: { ...whereForQuery, stock_quantity: 0 }
                }),
                Product.count({
                    where: buildWhereWithAndFrom(whereForQuery, [
                        { stock_quantity: { [Op.gt]: 0 } },
                        where(col('stock_quantity'), Op.lte, col('min_stock'))
                    ])
                })
            ]);

            return { listResult, emptyStockCount, lowStockCount };
        };

        let { listResult, emptyStockCount, lowStockCount } = await runQuery('and');
        if (tokens.length > 1 && getCountNumber((listResult as any)?.count) === 0) {
            ({ listResult, emptyStockCount, lowStockCount } = await runQuery('or'));
        }

        const { count, rows } = listResult;

        res.json({
            total: count,
            totalPages: Math.ceil(count / normalizedLimit),
            currentPage: normalizedPage,
            emptyStockCount,
            lowStockCount,
            products: rows,
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        const message = error instanceof Error ? error.message : 'Error fetching products';
        console.error('Error fetching admin products:', error);
        if (message.includes('Kolom products belum lengkap')) {
            throw new CustomError(message, 400);
        }
        throw new CustomError('Error fetching products', 500);
    }
});

export const getRestockSuggestions = asyncWrapper(async (req: Request, res: Response) => {
    try {
        await ensureProductColumnsReady();

        const { page = 1, limit = 50, search, status = 'active' } = req.query;
        const normalizedPage = Math.max(1, Number(page) || 1);
        const normalizedLimit = Math.min(200, Math.max(1, Number(limit) || 50));

        const whereClause: any = {};
        const normalizedStatus = String(status).toLowerCase();
        if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
            whereClause.status = normalizedStatus;
        }

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

        const runQuery = async (mode: 'and' | 'or') => {
            const whereForQuery = tokens.length > 0 ? buildSearchWhere(mode) : whereClause;
            const buildWhereWithAndFrom = (source: any, extras: any[]) => {
                const next: any = { ...source };
                const existing = next[Op.and];
                const andParts: any[] = [];
                if (Array.isArray(existing)) andParts.push(...existing);
                else if (existing) andParts.push(existing);
                andParts.push(...extras);
                next[Op.and] = andParts;
                return next;
            };

            const restockWhereForQuery = buildWhereWithAndFrom(whereForQuery, [
                {
                    [Op.or]: [
                        { stock_quantity: { [Op.lte]: 0 } },
                        {
                            [Op.and]: [
                                { min_stock: { [Op.not]: null } },
                                where(col('stock_quantity'), Op.lte, col('min_stock'))
                            ]
                        }
                    ]
                }
            ]);

            return Product.findAndCountAll({
                where: restockWhereForQuery,
                include: [
                    { model: Category, attributes: ['id', 'name'] },
                    { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
                ],
                limit: normalizedLimit,
                offset: (normalizedPage - 1) * normalizedLimit,
                order: [
                    [sequelize.literal('CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END'), 'DESC'],
                    [sequelize.literal('(COALESCE(min_stock, 0) - stock_quantity)'), 'DESC'],
                    ...(matchCountLiteral ? [[matchCountLiteral, 'DESC'] as any] : []),
                    ['name', 'ASC']
                ],
                distinct: true
            });
        };

        let result = await runQuery('and');
        if (tokens.length > 1 && getCountNumber((result as any)?.count) === 0) {
            result = await runQuery('or');
        }

        res.json({
            total: result.count,
            totalPages: Math.ceil(Number(result.count) / normalizedLimit),
            currentPage: normalizedPage,
            products: result.rows
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        const message = error instanceof Error ? error.message : 'Error fetching restock suggestions';
        console.error('Error fetching restock suggestions:', error);
        if (message.includes('Kolom products belum lengkap')) {
            throw new CustomError(message, 400);
        }
        throw new CustomError('Error fetching restock suggestions', 500);
    }
});

export const getProductBySku = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const queryCode = readCellText(req.query.code);
        const paramSku = readCellText(req.params.sku);
        const code = queryCode || paramSku;
        if (!code) {
            throw new CustomError('SKU/barcode wajib diisi', 400);
        }

        const product = await Product.findOne({
            where: {
                [Op.or]: [
                    { sku: code },
                    { barcode: code }
                ]
            },
            include: [
                { model: Category, attributes: ['id', 'name'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
            ]
        });

        if (!product) {
            throw new CustomError('Product not found', 404);
        }

        res.json(product);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching product', 500);
    }
});

export const uploadProductImage = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            throw new CustomError('File gambar wajib diunggah', 400);
        }

        if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype)) {
            throw new CustomError('Format gambar tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.', 400);
        }

        if (file.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
            throw new CustomError('Ukuran gambar terlalu besar (maksimal 2MB).', 400);
        }

        const userId = (req as any).user?.id || 'anonymous';
        const uploadDir = path.resolve(process.cwd(), 'uploads', String(userId), 'products');
        await fs.mkdir(uploadDir, { recursive: true });

        const fileExt = resolveProductImageExtension(file);
        const fileName = `prd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${fileExt}`;
        const absolutePath = path.join(uploadDir, fileName);
        await fs.writeFile(absolutePath, file.buffer);

        const imagePath = `/uploads/${userId}/products/${fileName}`;
        const configuredPublicBase = String(process.env.BACKEND_PUBLIC_URL || '').trim().replace(/\/$/, '');
        const imagePublicUrl = configuredPublicBase ? `${configuredPublicBase}${imagePath}` : imagePath;

        return res.status(201).json({
            message: 'Gambar produk berhasil diunggah',
            image_url: imagePath,
            image_public_url: imagePublicUrl,
            file_name: fileName
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error uploading product image', 500);
    }
});

export const createProduct = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { sku, barcode, name, description, image_url, base_price, price, unit, min_stock, category_id, stock_quantity, bin_location, vehicle_compatibility } = req.body;
        const normalizedSku = String(sku || '').trim();
        const normalizedName = String(name || '').trim();
        const normalizedUnit = String(unit || '').trim();
        const normalizedCategoryId = Number(category_id);

        if (!normalizedSku) {
            await t.rollback();
            throw new CustomError('SKU wajib diisi', 400);
        }
        if (!normalizedName) {
            await t.rollback();
            throw new CustomError('Nama produk wajib diisi', 400);
        }
        if (!normalizedUnit) {
            await t.rollback();
            throw new CustomError('Unit produk wajib diisi', 400);
        }
        if (!Number.isInteger(normalizedCategoryId) || normalizedCategoryId <= 0) {
            await t.rollback();
            throw new CustomError('category_id tidak valid', 400);
        }

        const existingProduct = await Product.findOne({ where: { sku: normalizedSku } });
        if (existingProduct) {
            await t.rollback();
            throw new CustomError('Product with this SKU already exists', 400);
        }

        const category = await Category.findByPk(normalizedCategoryId, { transaction: t });
        if (!category) {
            await t.rollback();
            throw new CustomError('Kategori tidak ditemukan', 404);
        }

        const normalizedImageUrl = String(image_url ?? '').trim() || null;
        const normalizedDescription = String(description ?? '').trim() || null;
        const normalizedBinLocation = String(bin_location ?? '').trim() || null;

        const inputVehicleTokens = parseVehicleCompatibilityInput(vehicle_compatibility);
        let normalizedVehicleCompatibility: string | null = null;
        if (inputVehicleTokens.length > 0) {
            const vehicleSetting = await Setting.findByPk(VEHICLE_TYPES_SETTING_KEY, { transaction: t, lock: t.LOCK.UPDATE });
            const optionsRaw = Array.isArray(vehicleSetting?.value) ? vehicleSetting?.value : [];
            const canonicalMap = buildCanonicalVehicleMap(optionsRaw.map((v: any) => String(v ?? '')));
            const { canonical, unknown } = canonicalizeVehicleList(inputVehicleTokens, canonicalMap);
            if (unknown.length > 0) {
                await t.rollback();
                throw new CustomError(`Jenis kendaraan belum terdaftar: ${unknown.join(', ')}. Tambah dulu di master.`, 400);
            }
            normalizedVehicleCompatibility = toVehicleCompatibilityDbValue(canonical);
        }

        const product = await Product.create({
            sku: normalizedSku,
            barcode,
            name: normalizedName,
            description: normalizedDescription,
            image_url: normalizedImageUrl,
            base_price,
            price,
            unit: normalizedUnit,
            min_stock,
            category_id: normalizedCategoryId,
            stock_quantity: 0,
            bin_location: normalizedBinLocation,
            vehicle_compatibility: normalizedVehicleCompatibility
        }, { transaction: t });
        await syncProductCategories(product.id, [normalizedCategoryId], t);

        // Handles initial stock via mutation if provided
        if (stock_quantity && stock_quantity > 0) {
            if (!Number.isFinite(Number(base_price)) || Number(base_price) <= 0) {
                await t.rollback();
                throw new CustomError('Harga beli (base_price) wajib > 0 jika stok awal > 0 (untuk pencatatan HPP/profit).', 400);
            }

            await StockMutation.create({
                product_id: product.id,
                type: 'initial',
                qty: stock_quantity,
                note: 'Initial Stock via Create Product',
                reference_id: 'INIT-' + normalizedSku
            }, { transaction: t });

            await product.update({ stock_quantity }, { transaction: t });

            await InventoryCostService.recordInbound({
                product_id: String(product.id),
                qty: stock_quantity,
                unit_cost: Number(base_price),
                reference_type: 'product_create',
                reference_id: 'INIT-' + normalizedSku,
                note: 'Initial Stock via Create Product',
                transaction: t
            });
        }

        await t.commit();
        res.status(201).json(product);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        if (error instanceof UniqueConstraintError || error instanceof ValidationError) {
            const firstMessage = error.errors?.[0]?.message;
            throw new CustomError(firstMessage || 'Data produk tidak valid', 400);
        }
        throw new CustomError('Error creating product', 500);
    }
});

export const updateProduct = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const payload = req.body as Record<string, unknown>;
        const blockedPricingFields = ['price', 'varian_harga'];
        const attemptedPricingFields = blockedPricingFields.filter((field) => payload[field] !== undefined);
        if (attemptedPricingFields.length > 0) {
            await t.rollback();
            throw new CustomError('Modifikasi harga tier tidak tersedia di modul gudang. Gunakan modul Admin Sales/Kasir.', 403);
        }

        const allowedFields = new Set([
            'sku',
            'barcode',
            'name',
            'description',
            'image_url',
            'base_price',
            'price',
            'unit',
            'min_stock',
            'category_id',
            'category_ids',
            'status',
            'keterangan',
            'tipe_modal',
            'varian_harga',
            'grosir',
            'grosir',
            'total_modal',
            'bin_location',
            'vehicle_compatibility'
        ]);

        const updates = Object.entries(payload).reduce<Record<string, unknown>>((acc, [key, value]) => {
            if (!allowedFields.has(key)) return acc;
            acc[key] = value;
            return acc;
        }, {});

        if (updates.image_url !== undefined) {
            updates.image_url = String(updates.image_url ?? '').trim() || null;
        }
        if (updates.description !== undefined) {
            updates.description = String(updates.description ?? '').trim() || null;
        }
        if (updates.barcode !== undefined) {
            updates.barcode = String(updates.barcode ?? '').trim() || null;
        }
        if (updates.keterangan !== undefined) {
            updates.keterangan = String(updates.keterangan ?? '').trim() || null;
        }
        if (updates.tipe_modal !== undefined) {
            updates.tipe_modal = String(updates.tipe_modal ?? '').trim() || null;
        }
        if (updates.bin_location !== undefined) {
            updates.bin_location = String(updates.bin_location ?? '').trim() || null;
        }
        if (updates.vehicle_compatibility !== undefined) {
            const inputVehicleTokens = parseVehicleCompatibilityInput(updates.vehicle_compatibility);
            if (inputVehicleTokens.length === 0) {
                updates.vehicle_compatibility = null;
            } else {
                const vehicleSetting = await Setting.findByPk(VEHICLE_TYPES_SETTING_KEY, { transaction: t, lock: t.LOCK.UPDATE });
                const optionsRaw = Array.isArray(vehicleSetting?.value) ? vehicleSetting?.value : [];
                const canonicalMap = buildCanonicalVehicleMap(optionsRaw.map((v: any) => String(v ?? '')));
                const { canonical, unknown } = canonicalizeVehicleList(inputVehicleTokens, canonicalMap);
                if (unknown.length > 0) {
                    await t.rollback();
                    throw new CustomError(`Jenis kendaraan belum terdaftar: ${unknown.join(', ')}. Tambah dulu di master.`, 400);
                }
                updates.vehicle_compatibility = toVehicleCompatibilityDbValue(canonical);
            }
        }

        const [updated] = await Product.update(updates, { where: { id }, transaction: t });

        if (updated) {
            const updatedProduct = await Product.findByPk(String(id), { transaction: t });
            if (updatedProduct && Array.isArray(updates.category_ids)) {
                const normalizedIds = updates.category_ids
                    .map((value: unknown) => Number(value))
                    .filter((value: number) => Number.isInteger(value) && value > 0);

                if (normalizedIds.length > 0) {
                    await syncProductCategories(updatedProduct.id, normalizedIds, t);
                }
            } else if (updatedProduct && updates.category_id !== undefined) {
                const mappings = await ProductCategory.findAll({
                    attributes: ['category_id'],
                    where: { product_id: updatedProduct.id },
                    transaction: t,
                    raw: true
                });
                const mappedIds = mappings.map((item: any) => Number(item.category_id)).filter((value: number) => Number.isInteger(value) && value > 0);
                const mergedIds = [...new Set([...mappedIds, Number(updates.category_id)])].filter((value) => Number.isInteger(value) && value > 0);
                await syncProductCategories(updatedProduct.id, mergedIds, t);
            }
            await t.commit();
            return res.status(200).json(updatedProduct);
        }

        await t.rollback();
        throw new CustomError('Product not found', 404);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        const message = error instanceof Error ? error.message : 'Error updating product';
        if (message.toLowerCase().includes('data too long for column') && message.toLowerCase().includes('image_url')) {
            throw new CustomError('URL gambar terlalu panjang untuk disimpan. Gunakan URL yang lebih pendek atau jalankan migrasi kolom image_url.', 400);
        }
        if (message.toLowerCase().includes("unknown column 'image_url'")) {
            throw new CustomError('Kolom image_url belum ada di database. Jalankan migrasi SQL untuk kolom image_url.', 400);
        }
        throw new CustomError('Error updating product', 500);
    }
});

export const updateProductTierPricing = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            throw new CustomError('Hanya admin sales/kasir yang bisa memodifikasi harga tier.', 403);
        }

        const regularPrice = toNonNegativeNumber(req.body?.regular_price ?? req.body?.regular);
        const goldPrice = toNonNegativeNumber(req.body?.gold_price ?? req.body?.gold);
        const platinumPrice = toNonNegativeNumber(
            req.body?.premium_price ?? req.body?.premium ?? req.body?.platinum_price ?? req.body?.platinum
        );

        if (regularPrice === null || goldPrice === null || platinumPrice === null) {
            await t.rollback();
            throw new CustomError('regular_price, gold_price, dan premium_price/platinum_price wajib berupa angka valid (>= 0).', 400);
        }

        const product = await Product.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!product) {
            await t.rollback();
            throw new CustomError('Product not found', 404);
        }

        const previousVariant = toObjectOrEmpty(product.varian_harga);
        const previousPrices = toObjectOrEmpty(previousVariant.prices);
        const previousDiscounts = toObjectOrEmpty(previousVariant.discounts_pct);

        const discountFromRegular = (targetPrice: number): number => {
            if (regularPrice <= 0) return 0;
            const pct = ((regularPrice - targetPrice) / regularPrice) * 100;
            return Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
        };

        const tierPrices = {
            regular: regularPrice,
            gold: goldPrice,
            platinum: platinumPrice,
            premium: platinumPrice
        };

        const nextVariantHarga = {
            ...previousVariant,
            regular: regularPrice,
            gold: goldPrice,
            platinum: platinumPrice,
            premium: platinumPrice,
            base_price: regularPrice,
            prices: {
                ...previousPrices,
                ...tierPrices
            },
            discounts_pct: {
                ...previousDiscounts,
                regular: discountFromRegular(regularPrice),
                gold: discountFromRegular(goldPrice),
                platinum: discountFromRegular(platinumPrice),
                premium: discountFromRegular(platinumPrice)
            }
        };

        await product.update({
            price: regularPrice,
            varian_harga: nextVariantHarga
        }, { transaction: t });

        await t.commit();
        return res.status(200).json({
            message: 'Harga tier produk berhasil diperbarui.',
            product,
            tier_pricing: tierPrices
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating product tier pricing', 500);
    }
});

export const bulkUpdateTierDiscounts = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            throw new CustomError('Hanya admin sales/kasir yang bisa memodifikasi diskon tier.', 403);
        }

        const regularDiscountRaw =
            req.body?.regular_discount_pct ??
            req.body?.regular_discount ??
            req.body?.regular;
        const regularDiscount = regularDiscountRaw === undefined
            ? 0
            : toPercentageNumber(regularDiscountRaw);
        const goldDiscount = toPercentageNumber(req.body?.gold_discount_pct ?? req.body?.gold_discount ?? req.body?.gold);
        const premiumDiscount = toPercentageNumber(
            req.body?.premium_discount_pct ??
            req.body?.premium_discount ??
            req.body?.premium ??
            req.body?.platinum_discount_pct ??
            req.body?.platinum_discount ??
            req.body?.platinum
        );

        if (regularDiscount === null || goldDiscount === null || premiumDiscount === null) {
            await t.rollback();
            throw new CustomError('regular_discount_pct (optional), gold_discount_pct, dan premium_discount_pct/platinum_discount_pct wajib angka valid antara 0 sampai 100.', 400);
        }

        const rawProductIds = req.body?.product_ids ?? req.body?.productIds;
        const productIds = Array.isArray(rawProductIds)
            ? rawProductIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
            : typeof rawProductIds === 'string'
                ? rawProductIds.split(',').map((value) => value.trim()).filter(Boolean)
                : [];
        if (rawProductIds !== undefined && productIds.length === 0) {
            await t.rollback();
            throw new CustomError('product_ids tidak valid atau kosong.', 400);
        }

        const statusRaw = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'active';
        const whereClause: Record<string, unknown> = {};
        if (statusRaw === 'active' || statusRaw === 'inactive') {
            whereClause.status = statusRaw;
        }

        const searchRaw = typeof req.body?.search === 'string' ? req.body.search.trim() : '';
        if (searchRaw) {
            whereClause[Op.or as unknown as string] = [
                { name: { [Op.like]: `%${searchRaw}%` } },
                { sku: { [Op.like]: `%${searchRaw}%` } },
                { barcode: { [Op.like]: `%${searchRaw}%` } }
            ];
        }

        if (productIds.length > 0) {
            whereClause.id = { [Op.in]: productIds };
        }

        const products = await Product.findAll({
            where: whereClause,
            attributes: ['id', 'price', 'varian_harga'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        let updatedCount = 0;

        for (const product of products) {
            const previousVariant = toObjectOrEmpty(product.varian_harga);
            const previousPrices = toObjectOrEmpty(previousVariant.prices);
            const previousDiscounts = toObjectOrEmpty(previousVariant.discounts_pct);

            let baseRegularPrice = roundPrice(Number((previousVariant.base_price ?? previousPrices.base_price ?? product.price) ?? 0));
            if (baseRegularPrice <= 0) {
                const variant = toObjectOrEmpty(product.varian_harga);
                const prices = toObjectOrEmpty(variant.prices);
                const candidates: unknown[] = [
                    prices.regular,
                    variant.regular,
                    prices.base_price,
                    variant.base_price,
                    prices.price,
                    variant.price
                ];
                for (const candidate of candidates) {
                    const parsed = Number(candidate);
                    if (Number.isFinite(parsed) && parsed > 0) {
                        baseRegularPrice = roundPrice(parsed);
                        break;
                    }
                }
            }
            const regularPrice = roundPrice(baseRegularPrice * (1 - (regularDiscount / 100)));
            const goldPrice = roundPrice(regularPrice * (1 - (goldDiscount / 100)));
            const premiumPrice = roundPrice(regularPrice * (1 - (premiumDiscount / 100)));

            const nextVariantHarga = {
                ...previousVariant,
                regular: regularPrice,
                gold: goldPrice,
                platinum: premiumPrice,
                premium: premiumPrice,
                base_price: baseRegularPrice,
                prices: {
                    ...previousPrices,
                    base_price: baseRegularPrice,
                    regular: regularPrice,
                    gold: goldPrice,
                    platinum: premiumPrice,
                    premium: premiumPrice
                },
                discounts_pct: {
                    ...previousDiscounts,
                    regular: regularDiscount,
                    gold: goldDiscount,
                    platinum: premiumDiscount,
                    premium: premiumDiscount
                }
            };

            await product.update({
                price: regularPrice,
                varian_harga: nextVariantHarga
            }, { transaction: t });
            updatedCount += 1;
        }

        await t.commit();
        return res.status(200).json({
            message: `Diskon tier berhasil diterapkan ke ${updatedCount} produk.`,
            updated_count: updatedCount,
            discounts_pct: {
                regular: regularDiscount,
                gold: goldDiscount,
                premium: premiumDiscount,
                platinum: premiumDiscount
            }
        });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error bulk updating tier discounts', 500);
    }
});

export const scanProduct = asyncWrapper(async (req: Request, res: Response) => {
    // Same as getProductBySku logic basically but intended for scanner
    return getProductBySku(req, res, () => { });
});
