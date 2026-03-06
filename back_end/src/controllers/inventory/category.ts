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
import { normalizeCategoryIcon, parseCategoryDiscountField, toNullablePercentage } from './utils';
export const getCategories = async (_req: Request, res: Response) => {
    try {
        const categories = await Category.findAll({
            attributes: ['id', 'name', 'description', 'icon', 'discount_regular_pct', 'discount_gold_pct', 'discount_premium_pct'],
            order: [['name', 'ASC']]
        });
        res.json({ categories });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error });
    }
};

export const createCategory = async (req: Request, res: Response) => {
    try {
        const name = String(req.body?.name || '').trim();
        const description = String(req.body?.description || '').trim();
        let icon: string | null = null;

        if (!name) {
            return res.status(400).json({ message: 'Nama kategori wajib diisi' });
        }

        try {
            icon = normalizeCategoryIcon(req.body?.icon);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Nilai icon tidak valid';
            return res.status(400).json({ message });
        }

        const existingCategory = await Category.findOne({ where: { name } });
        if (existingCategory) {
            return res.status(400).json({ message: 'Nama kategori sudah digunakan' });
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
            return res.status(400).json({ message });
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
        res.status(500).json({ message: 'Error creating category', error });
    }
};

export const updateCategory = async (req: Request, res: Response) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            return res.status(400).json({ message: 'ID kategori tidak valid' });
        }

        const category = await Category.findByPk(categoryId);
        if (!category) {
            return res.status(404).json({ message: 'Kategori tidak ditemukan' });
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
                return res.status(400).json({ message: 'Nama kategori wajib diisi' });
            }

            const duplicate = await Category.findOne({
                where: {
                    name: nextName,
                    id: { [Op.ne]: categoryId }
                }
            });
            if (duplicate) {
                return res.status(400).json({ message: 'Nama kategori sudah digunakan' });
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
                return res.status(400).json({ message });
            }
        }

        if (req.body?.discount_regular_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_regular_pct);
            if (parsed === undefined) {
                return res.status(400).json({ message: 'discount_regular_pct harus angka antara 0 sampai 100 atau null.' });
            }
            updates.discount_regular_pct = parsed;
        }

        if (req.body?.discount_gold_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_gold_pct);
            if (parsed === undefined) {
                return res.status(400).json({ message: 'discount_gold_pct harus angka antara 0 sampai 100 atau null.' });
            }
            updates.discount_gold_pct = parsed;
        }

        if (req.body?.discount_premium_pct !== undefined) {
            const parsed = toNullablePercentage(req.body.discount_premium_pct);
            if (parsed === undefined) {
                return res.status(400).json({ message: 'discount_premium_pct harus angka antara 0 sampai 100 atau null.' });
            }
            updates.discount_premium_pct = parsed;
        }

        await category.update(updates);
        res.json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
};

export const updateCategoryTierDiscount = async (req: Request, res: Response) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            return res.status(400).json({ message: 'ID kategori tidak valid' });
        }

        const category = await Category.findByPk(categoryId);
        if (!category) {
            return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        }

        const hasRegular = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_regular_pct');
        const hasGold = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_gold_pct');
        const hasPremium = Object.prototype.hasOwnProperty.call(req.body || {}, 'discount_premium_pct');
        if (!hasRegular || !hasGold || !hasPremium) {
            return res.status(400).json({
                message: 'discount_regular_pct, discount_gold_pct, dan discount_premium_pct wajib dikirim (boleh null untuk fallback).'
            });
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
            return res.status(400).json({ message });
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
        return res.status(500).json({ message: 'Error updating category tier discount', error });
    }
};

export const deleteCategory = async (req: Request, res: Response) => {
    const transaction = await sequelize.transaction();
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId) || categoryId <= 0) {
            await transaction.rollback();
            return res.status(400).json({ message: 'ID kategori tidak valid' });
        }

        const category = await Category.findByPk(categoryId, { transaction });
        if (!category) {
            await transaction.rollback();
            return res.status(404).json({ message: 'Kategori tidak ditemukan' });
        }

        const replacementIdRaw = req.body?.replacement_category_id;
        const hasReplacement = replacementIdRaw !== undefined && replacementIdRaw !== null && String(replacementIdRaw).trim() !== '';

        if (hasReplacement) {
            const replacementCategoryId = Number(replacementIdRaw);
            if (!Number.isInteger(replacementCategoryId) || replacementCategoryId <= 0) {
                await transaction.rollback();
                return res.status(400).json({ message: 'replacement_category_id tidak valid' });
            }
            if (replacementCategoryId === categoryId) {
                await transaction.rollback();
                return res.status(400).json({ message: 'Kategori pengganti tidak boleh sama' });
            }

            const replacementCategory = await Category.findByPk(replacementCategoryId, { transaction });
            if (!replacementCategory) {
                await transaction.rollback();
                return res.status(404).json({ message: 'Kategori pengganti tidak ditemukan' });
            }

            const [movedCount] = await Product.update(
                { category_id: replacementCategoryId },
                { where: { category_id: categoryId }, transaction }
            );

            await category.destroy({ transaction });
            await transaction.commit();
            return res.json({
                message: 'Kategori berhasil dihapus dan produk dipindahkan',
                moved_products: movedCount
            });
        }

        const totalProducts = await Product.count({ where: { category_id: categoryId }, transaction });
        if (totalProducts > 0) {
            await transaction.rollback();
            return res.status(400).json({
                message: `Kategori masih dipakai ${totalProducts} produk. Pilih replacement_category_id untuk memindahkan produk sebelum hapus.`
            });
        }

        await category.destroy({ transaction });
        await transaction.commit();
        return res.json({ message: 'Kategori berhasil dihapus' });
    } catch (error) {
        await transaction.rollback();
        res.status(500).json({ message: 'Error deleting category', error });
    }
};
