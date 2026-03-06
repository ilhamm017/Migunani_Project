import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { syncProductCategories, toObjectOrEmpty, ensureProductColumnsReady, PRODUCT_IMAGE_MAX_SIZE_BYTES, toPercentageNumber, ALLOWED_PRODUCT_IMAGE_MIME_TYPES, toNonNegativeNumber, roundPrice, readCellText, resolveProductImageExtension } from './utils';
export const getProducts = async (req: Request, res: Response) => {
    try {
        await ensureProductColumnsReady();

        const { page = 1, limit = 10, search, category_id, status = 'all' } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        const normalizedStatus = String(status).toLowerCase();
        if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
            whereClause.status = normalizedStatus;
        }

        if (search) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${search}%` } },
                { sku: { [Op.like]: `%${search}%` } },
                { barcode: { [Op.like]: `%${search}%` } }
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

        const { count, rows } = await Product.findAndCountAll({
            where: whereClause,
            include: [
                { model: Category, attributes: ['id', 'name'] },
                { model: Category, as: 'Categories', attributes: ['id', 'name'], through: { attributes: [] }, required: false }
            ],
            limit: Number(limit),
            offset: Number(offset),
            order: [['name', 'ASC']],
            distinct: true
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / Number(limit)),
            currentPage: Number(page),
            products: rows
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error fetching products';
        console.error('Error fetching admin products:', error);
        if (message.includes('Kolom products belum lengkap')) {
            return res.status(400).json({ message });
        }
        res.status(500).json({ message: 'Error fetching products', error });
    }
};

export const getProductBySku = async (req: Request, res: Response) => {
    try {
        const queryCode = readCellText(req.query.code);
        const paramSku = readCellText(req.params.sku);
        const code = queryCode || paramSku;
        if (!code) {
            return res.status(400).json({ message: 'SKU/barcode wajib diisi' });
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
            return res.status(404).json({ message: 'Product not found' });
        }

        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching product', error });
    }
};

export const uploadProductImage = async (req: Request, res: Response) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ message: 'File gambar wajib diunggah' });
        }

        if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.has(file.mimetype)) {
            return res.status(400).json({ message: 'Format gambar tidak didukung. Gunakan JPG, PNG, WEBP, atau GIF.' });
        }

        if (file.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
            return res.status(400).json({ message: 'Ukuran gambar terlalu besar (maksimal 2MB).' });
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
        return res.status(500).json({ message: 'Error uploading product image', error });
    }
};

export const createProduct = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { sku, barcode, name, description, image_url, base_price, price, unit, min_stock, category_id, stock_quantity, bin_location, vehicle_compatibility } = req.body;

        const existingProduct = await Product.findOne({ where: { sku } });
        if (existingProduct) {
            await t.rollback();
            return res.status(400).json({ message: 'Product with this SKU already exists' });
        }

        const normalizedImageUrl = String(image_url ?? '').trim() || null;
        const normalizedDescription = String(description ?? '').trim() || null;
        const normalizedBinLocation = String(bin_location ?? '').trim() || null;
        let normalizedVehicleCompatibility = vehicle_compatibility;
        if (typeof vehicle_compatibility === 'object' && vehicle_compatibility !== null) {
            normalizedVehicleCompatibility = JSON.stringify(vehicle_compatibility);
        } else {
            normalizedVehicleCompatibility = String(vehicle_compatibility ?? '').trim() || null;
        }

        const product = await Product.create({
            sku,
            barcode,
            name,
            description: normalizedDescription,
            image_url: normalizedImageUrl,
            base_price,
            price,
            unit,
            min_stock,
            category_id,
            stock_quantity: 0,
            bin_location: normalizedBinLocation,
            vehicle_compatibility: normalizedVehicleCompatibility
        }, { transaction: t });
        await syncProductCategories(product.id, [Number(category_id)], t);

        // Handles initial stock via mutation if provided
        if (stock_quantity && stock_quantity > 0) {
            await StockMutation.create({
                product_id: product.id,
                type: 'initial',
                qty: stock_quantity,
                note: 'Initial Stock via Create Product',
                reference_id: 'INIT-' + sku
            }, { transaction: t });

            await product.update({ stock_quantity }, { transaction: t });
        }

        await t.commit();
        res.status(201).json(product);
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error creating product', error });
    }
};

export const updateProduct = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const payload = req.body as Record<string, unknown>;
        const blockedPricingFields = ['price', 'varian_harga'];
        const attemptedPricingFields = blockedPricingFields.filter((field) => payload[field] !== undefined);
        if (attemptedPricingFields.length > 0) {
            await t.rollback();
            return res.status(403).json({
                message: 'Modifikasi harga tier tidak tersedia di modul gudang. Gunakan modul Admin Sales/Kasir.'
            });
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
            // vehicle_compatibility is TEXT, we might want to keep it as string or stringified JSON
            const rawVal = updates.vehicle_compatibility;
            if (typeof rawVal === 'object' && rawVal !== null) {
                updates.vehicle_compatibility = JSON.stringify(rawVal);
            } else {
                updates.vehicle_compatibility = String(rawVal ?? '').trim() || null;
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
        return res.status(404).json({ message: 'Product not found' });
    } catch (error) {
        await t.rollback();
        const message = error instanceof Error ? error.message : 'Error updating product';
        if (message.toLowerCase().includes('data too long for column') && message.toLowerCase().includes('image_url')) {
            return res.status(400).json({ message: 'URL gambar terlalu panjang untuk disimpan. Gunakan URL yang lebih pendek atau jalankan migrasi kolom image_url.' });
        }
        if (message.toLowerCase().includes("unknown column 'image_url'")) {
            return res.status(400).json({ message: 'Kolom image_url belum ada di database. Jalankan migrasi SQL untuk kolom image_url.' });
        }
        res.status(500).json({ message: 'Error updating product', error });
    }
};

export const updateProductTierPricing = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin sales/kasir yang bisa memodifikasi harga tier.' });
        }

        const regularPrice = toNonNegativeNumber(req.body?.regular_price ?? req.body?.regular);
        const goldPrice = toNonNegativeNumber(req.body?.gold_price ?? req.body?.gold);
        const platinumPrice = toNonNegativeNumber(
            req.body?.premium_price ?? req.body?.premium ?? req.body?.platinum_price ?? req.body?.platinum
        );

        if (regularPrice === null || goldPrice === null || platinumPrice === null) {
            await t.rollback();
            return res.status(400).json({
                message: 'regular_price, gold_price, dan premium_price/platinum_price wajib berupa angka valid (>= 0).'
            });
        }

        const product = await Product.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
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
        await t.rollback();
        return res.status(500).json({ message: 'Error updating product tier pricing', error });
    }
};

export const bulkUpdateTierDiscounts = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const actorRole = String(req.user?.role || '');
        if (actorRole !== 'kasir' && actorRole !== 'super_admin') {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin sales/kasir yang bisa memodifikasi diskon tier.' });
        }

        const goldDiscount = toPercentageNumber(req.body?.gold_discount_pct ?? req.body?.gold_discount ?? req.body?.gold);
        const premiumDiscount = toPercentageNumber(
            req.body?.premium_discount_pct ??
            req.body?.premium_discount ??
            req.body?.premium ??
            req.body?.platinum_discount_pct ??
            req.body?.platinum_discount ??
            req.body?.platinum
        );

        if (goldDiscount === null || premiumDiscount === null) {
            await t.rollback();
            return res.status(400).json({
                message: 'gold_discount_pct dan premium_discount_pct/platinum_discount_pct wajib angka valid antara 0 sampai 100.'
            });
        }

        const statusRaw = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : 'active';
        const whereClause: Record<string, unknown> = {};
        if (statusRaw === 'active' || statusRaw === 'inactive') {
            whereClause.status = statusRaw;
        }

        const products = await Product.findAll({
            where: whereClause,
            attributes: ['id', 'price', 'varian_harga'],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        let updatedCount = 0;

        for (const product of products) {
            const regularPrice = roundPrice(Number(product.price || 0));
            const goldPrice = roundPrice(regularPrice * (1 - (goldDiscount / 100)));
            const premiumPrice = roundPrice(regularPrice * (1 - (premiumDiscount / 100)));

            const previousVariant = toObjectOrEmpty(product.varian_harga);
            const previousPrices = toObjectOrEmpty(previousVariant.prices);
            const previousDiscounts = toObjectOrEmpty(previousVariant.discounts_pct);

            const nextVariantHarga = {
                ...previousVariant,
                regular: regularPrice,
                gold: goldPrice,
                platinum: premiumPrice,
                premium: premiumPrice,
                base_price: regularPrice,
                prices: {
                    ...previousPrices,
                    regular: regularPrice,
                    gold: goldPrice,
                    platinum: premiumPrice,
                    premium: premiumPrice
                },
                discounts_pct: {
                    ...previousDiscounts,
                    regular: 0,
                    gold: goldDiscount,
                    platinum: premiumDiscount,
                    premium: premiumDiscount
                }
            };

            await product.update({
                varian_harga: nextVariantHarga
            }, { transaction: t });
            updatedCount += 1;
        }

        await t.commit();
        return res.status(200).json({
            message: `Diskon tier berhasil diterapkan ke ${updatedCount} produk.`,
            updated_count: updatedCount,
            discounts_pct: {
                regular: 0,
                gold: goldDiscount,
                premium: premiumDiscount,
                platinum: premiumDiscount
            }
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Error bulk updating tier discounts', error });
    }
};

export const scanProduct = async (req: Request, res: Response) => {
    // Same as getProductBySku logic basically but intended for scanner
    return getProductBySku(req, res);
};
