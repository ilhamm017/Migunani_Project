import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction, col, fn, literal } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { normalizeCategoryIcon, parseCategoryDiscountField, toNullablePercentage } from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const getCategories = asyncWrapper(async (_req: Request, res: Response) => {
    try {
        const [categories, primaryUsageRows, tagUsageRows] = await Promise.all([
            Category.findAll({
                attributes: ['id', 'name', 'description', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'],
                order: [['name', 'ASC']]
            }),
            Product.findAll({
                attributes: ['category_id', [fn('COUNT', col('id')), 'count']],
                group: ['category_id'],
                raw: true
            }) as unknown as Promise<Array<{ category_id: number | string; count: number | string }>>,
            ProductCategory.findAll({
                attributes: ['category_id', [fn('COUNT', literal('DISTINCT product_id')), 'count']],
                group: ['category_id'],
                raw: true
            }) as unknown as Promise<Array<{ category_id: number | string; count: number | string }>>
        ]);

        const primaryCountByCategory = new Map<number, number>();
        primaryUsageRows.forEach((row) => {
            const id = Number(row.category_id);
            if (!Number.isInteger(id) || id <= 0) return;
            primaryCountByCategory.set(id, Number(row.count) || 0);
        });

        const tagCountByCategory = new Map<number, number>();
        tagUsageRows.forEach((row) => {
            const id = Number(row.category_id);
            if (!Number.isInteger(id) || id <= 0) return;
            tagCountByCategory.set(id, Number(row.count) || 0);
        });

        const enriched = categories.map((category) => {
            const data = category.toJSON() as any;
            const primary_product_count = primaryCountByCategory.get(category.id) || 0;
            const tag_product_count = tagCountByCategory.get(category.id) || 0;
            return {
                ...data,
                primary_product_count,
                tag_product_count,
                is_primary: primary_product_count > 0,
                is_tag: tag_product_count > 0
            };
        });

        res.json({ categories: enriched });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching categories', 500);
    }
});

export const createCategory = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const description = String(req.body?.description || '').trim();
        let icon: string | null = null;

        if (!name) {
            throw new CustomError('Nama kategori wajib diisi', 400);
        }

        try {
            icon = normalizeCategoryIcon(req.body?.icon);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nilai icon tidak valid';
            throw new CustomError(message, 400);
        }

        const existingCategory = await Category.findOne({ where: { name } });
        if (existingCategory) {
            throw new CustomError('Nama kategori sudah digunakan', 400);
        }

        let regularDiscount: number | null = null;
        let goldDiscount: number | null = null;
        let premiumDiscount: number | null = null;
        try {
            if (req.body?.discount_regular_pct !== undefined) {
                regularDiscount = parseCategoryDiscountField(req.body.discount_regular_pct, 'discount_regular_pct');
            }
            if (req.body?.discount_gold_pct !== undefined) {
                goldDiscount = parseCategoryDiscountField(req.body.discount_gold_pct, 'discount_gold_pct');
            }
            if (req.body?.discount_premium_pct !== undefined) {
                premiumDiscount = parseCategoryDiscountField(req.body.discount_premium_pct, 'discount_premium_pct');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Diskon kategori tidak valid';
            throw new CustomError(message, 400);
        }

        const category = await Category.create({
            name,
            description: description || null,
            icon,
            discount_regular_pct: regularDiscount,
            discount_gold_pct: goldDiscount,
            discount_premium_pct: premiumDiscount
        });

        res.status(201).json(category);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating category', 500);
    }
});

export const updateCategory = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            throw new CustomError('ID kategori tidak valid', 400);
        }

        const category = await Category.findByPk(categoryId);
        if (!category) {
            throw new CustomError('Kategori tidak ditemukan', 404);
        }

        const updates: {
            name?: string;
            description?: string | null;
            icon?: string | null;
            discount_regular_pct?: number | null;
            discount_gold_pct?: number | null;
            discount_premium_pct?: number | null;
        } = {};

        if (req.body?.name !== undefined) {
            const nextName = String(req.body.name).trim();
            if (!nextName) {
                throw new CustomError('Nama kategori wajib diisi', 400);
            }

            const duplicate = await Category.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: categoryId }
                }
            });
            if (duplicate) {
                throw new CustomError('Nama kategori sudah digunakan', 400);
            }
            updates.name = nextName;
        }

        if (req.body?.description !== undefined) {
            const nextDescription = String(req.body.description || '').trim();
            updates.description = nextDescription || null;
        }

        if (req.body?.icon !== undefined) {
            try {
                updates.icon = normalizeCategoryIcon(req.body.icon);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Nilai icon tidak valid';
                throw new CustomError(message, 400);
            }
        }

        if (req.body?.discount_regular_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_regular_pct);
            if (parsed === undefined) {
                throw new CustomError('discount_regular_pct harus angka antara 0 sampai 100 atau null.', 400);
            }
            updates.discount_regular_pct = parsed;
        }

        if (req.body?.discount_gold_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_gold_pct);
            if (parsed === undefined) {
                throw new CustomError('discount_gold_pct harus angka antara 0 sampai 100 atau null.', 400);
            }
            updates.discount_gold_pct = parsed;
        }

        if (req.body?.discount_premium_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_premium_pct);
            if (parsed === undefined) {
                throw new CustomError('discount_premium_pct harus angka antara 0 sampai 100 atau null.', 400);
            }
            updates.discount_premium_pct = parsed;
        }

        await category.update(updates);
        res.json(category);
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating category', 500);
    }
});

export const updateCategoryTierDiscount = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            throw new CustomError('ID kategori tidak valid', 400);
        }

        const category = await Category.findByPk(categoryId);
        if (!category) {
            throw new CustomError('Kategori tidak ditemukan', 404);
        }

        const hasRegular = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_regular_pct');
        const hasGold = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_gold_pct');
        const hasPremium = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_premium_pct');
        if (!hasRegular || !hasGold || !hasPremium) {
            throw new CustomError('discount_regular_pct, discount_gold_pct, dan discount_premium_pct wajib dikirim (boleh null untuk fallback).', 400);
        }

        let regularDiscount: number | null;
        let goldDiscount: number | null;
        let premiumDiscount: number | null;
        try {
            regularDiscount = parseCategoryDiscountField(req.body?.discount_regular_pct, 'discount_regular_pct');
            goldDiscount = parseCategoryDiscountField(req.body?.discount_gold_pct, 'discount_gold_pct');
            premiumDiscount = parseCategoryDiscountField(req.body?.discount_premium_pct, 'discount_premium_pct');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Diskon kategori tidak valid';
            throw new CustomError(message, 400);
        }

        await category.update({
            discount_regular_pct: regularDiscount,
            discount_gold_pct: goldDiscount,
            discount_premium_pct: premiumDiscount
        });

        return res.json({
            message: 'Diskon tier kategori berhasil diperbarui.',
            category
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating category tier discount', 500);
    }
});

export const deleteCategory = asyncWrapper(async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            await transaction.rollback();
            throw new CustomError('ID kategori tidak valid', 400);
        }

        const category = await Category.findByPk(categoryId, { transaction });
        if (!category) {
            await transaction.rollback();
            throw new CustomError('Kategori tidak ditemukan', 404);
        }

        const replacementIdRaw = req.body?.replacement_category_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementCategoryId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementCategoryId) || replacementCategoryId <= 0) {
                await transaction.rollback();
                throw new CustomError('replacement_category_id tidak valid', 400);
            }
            if (replacementCategoryId === categoryId) {
                await transaction.rollback();
                throw new CustomError('Kategori pengganti tidak boleh sama', 400);
            }

            const replacementCategory = await Category.findByPk(replacementCategoryId, { transaction });
            if (!replacementCategory) {
                await transaction.rollback();
                throw new CustomError('Kategori pengganti tidak ditemukan', 404);
            }

            const [movedCount] = await Product.update(
                { category_id: replacementCategoryId },
                { where: { category_id: categoryId }, transaction }
            );

            const mappings = await ProductCategory.findAll({
                attributes: ['product_id'],
                where: { category_id: categoryId },
                transaction,
                raw: true
            }) as unknown as Array<{ product_id: string }>;

            let movedTagMappings = 0;
            let removedDuplicateMappings = 0;
            for (const mapping of mappings) {
                const productId = String(mapping.product_id || '');
                if (!productId) continue;

                const duplicate = await ProductCategory.findOne({
                    where: { product_id: productId, category_id: replacementCategoryId },
                    transaction
                });

                if (duplicate) {
                    removedDuplicateMappings += 1;
                    await ProductCategory.destroy({
                        where: { product_id: productId, category_id: categoryId },
                        transaction
                    });
                    continue;
                }

                const [updated] = await ProductCategory.update(
                    { category_id: replacementCategoryId },
                    { where: { product_id: productId, category_id: categoryId }, transaction }
                );
                movedTagMappings += Number(updated) || 0;
            }

            await category.destroy({ transaction });
            await transaction.commit();
            return res.json({
                message: 'Kategori berhasil dihapus dan produk dipindahkan',
                moved_products: movedCount,
                moved_tag_mappings: movedTagMappings,
                removed_duplicate_tag_mappings: removedDuplicateMappings
            });
        }

        const [totalPrimaryProducts, totalTaggedProducts] = await Promise.all([
            Product.count({ where: { category_id: categoryId }, transaction }),
            ProductCategory.count({ where: { category_id: categoryId }, transaction })
        ]);

        if (totalPrimaryProducts > 0 || totalTaggedProducts > 0) {
            await transaction.rollback();
            const detail = [
                totalPrimaryProducts > 0 ? `${totalPrimaryProducts} produk (kategori utama)` : null,
                totalTaggedProducts > 0 ? `${totalTaggedProducts} produk (tag/multi-kategori)` : null
            ].filter(Boolean).join(' + ');
            throw new CustomError(`Kategori masih dipakai ${detail}. Pilih replacement_category_id untuk memindahkan sebelum hapus.`, 400);
        }

        await category.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Kategori berhasil dihapus' });
    } catch (error) {
        try { await transaction.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error deleting category', 500);
    }
});
