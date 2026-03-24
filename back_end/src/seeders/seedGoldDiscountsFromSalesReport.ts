import crypto from 'crypto';
import { col, fn, where } from 'sequelize';
import { Category, Product, sequelize } from '../models';
import { salesReportDiskonSeedInvoices } from './data/sales_report_diskon_2026_03_24';

type SeedGoldDiscountsResult = {
    source: string;
    parsedInvoices: number;
    parsedItems: number;
    updatedProducts: number;
    createdProducts: number;
    skippedNoDiscount: number;
};

const toObjectOrEmpty = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

const ensureCategory = async (name: string) => {
    const existing = await Category.findOne({ where: { name } });
    if (existing) return existing;
    return Category.create({ name, description: 'Produk dari laporan penjualan (import seeding)', icon: 'tag' });
};

const generateSkuFromName = (name: string): string => {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 10).toUpperCase();
    return `SR-${hash}`;
};

export const seedGoldDiscountsFromSalesReport = async (options?: {
    invoices?: typeof salesReportDiskonSeedInvoices;
}): Promise<SeedGoldDiscountsResult> => {
    const invoices = (options?.invoices || salesReportDiskonSeedInvoices).map((inv) => ({
        ...inv,
        date: new Date(inv.date),
    }));
    const productDiscountByNameLower = new Map<string, { name: string; discountPct: number }>();
    let parsedItems = 0;
    let skippedNoDiscount = 0;

    for (const inv of invoices) {
        for (const item of inv.items) {
            parsedItems += 1;
            const pct = Number(item.discount_pct || 0);
            if (!Number.isFinite(pct) || pct <= 0) {
                skippedNoDiscount += 1;
                continue;
            }
            const name = item.product_name.trim();
            const keyLower = name.toLowerCase();
            const existing = productDiscountByNameLower.get(keyLower);
            if (!existing || pct > existing.discountPct) {
                productDiscountByNameLower.set(keyLower, { name, discountPct: pct });
            }
        }
    }

    const category = await ensureCategory('IMPORTED SALES');

    const t = await sequelize.transaction();
    try {
        let updatedProducts = 0;
        let createdProducts = 0;

        for (const [nameLower, row] of productDiscountByNameLower.entries()) {
            const productName = row.name;
            const discountPct = row.discountPct;
            const product = await Product.findOne({
                where: where(fn('lower', col('name')), nameLower),
                transaction: t
            });

            const target = product || await Product.create({
                sku: generateSkuFromName(productName),
                name: productName,
                description: null,
                image_url: null,
                base_price: 0,
                price: 0,
                unit: 'Pcs',
                stock_quantity: 0,
                allocated_quantity: 0,
                min_stock: 0,
                category_id: category.id,
                status: 'active',
                varian_harga: null,
                grosir: null,
                total_modal: null,
                keterangan: null,
                tipe_modal: null,
            } as any, { transaction: t });

            if (!product) createdProducts += 1;

            const variant = toObjectOrEmpty((target as any).varian_harga);
            const discounts = toObjectOrEmpty(variant.discounts_pct);

            const existingGold = Number(discounts.gold || 0);
            if (Number.isFinite(existingGold) && existingGold === discountPct) {
                continue;
            }

            const mergedVariant = {
                ...variant,
                discounts_pct: {
                    ...discounts,
                    gold: discountPct
                }
            };

            await target.update({ varian_harga: mergedVariant }, { transaction: t });
            updatedProducts += 1;
        }

        await t.commit();
        return {
            source: 'seeders/data/sales_report_diskon_2026_03_24.ts',
            parsedInvoices: invoices.length,
            parsedItems,
            updatedProducts,
            createdProducts,
            skippedNoDiscount
        };
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
};
