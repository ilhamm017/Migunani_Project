import crypto from 'crypto';
import { col, fn, where } from 'sequelize';
import { Category, CustomerProfile, Order, OrderItem, Product, User, sequelize } from '../models';
import { SalesReportInvoice } from './salesReportDiskonParser';
import { salesReportDiskonSeedInvoices } from './data/sales_report_diskon_2026_03_24';

type SeedPurchaseHistoryResult = {
    source: string;
    parsedInvoices: number;
    insertedOrders: number;
    insertedOrderItems: number;
    createdCustomers: number;
    promotedToGold: number;
    createdProducts: number;
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

const normalizeLower = (value: string): string => value.trim().toLowerCase();

const round2 = (value: number): number => Math.round(value * 100) / 100;

const computeUnitPaid = (invoice: SalesReportInvoice, item: SalesReportInvoice['items'][number]): number => {
    const qty = Math.max(1, Number(item.qty || 0));
    if (Number(item.subtotal || 0) > 0) return round2(Number(item.subtotal) / qty);
    if (Number(item.discount_amount || 0) > 0 && Number(item.price_per_unit || 0) > 0) {
        return round2(Math.max(0, Number(item.price_per_unit) - (Number(item.discount_amount) / qty)));
    }
    return round2(Number(item.price_per_unit || 0));
};

export const seedPurchaseHistoryFromSalesReport = async (options?: {
    invoices?: typeof salesReportDiskonSeedInvoices;
}): Promise<SeedPurchaseHistoryResult> => {
    const invoices: SalesReportInvoice[] = (options?.invoices || salesReportDiskonSeedInvoices).map((inv) => ({
        invoice_no: inv.invoice_no,
        date: new Date(inv.date),
        customer_name: inv.customer_name,
        bruto: inv.bruto,
        diskon: inv.diskon,
        netto: inv.netto,
        items: inv.items
    }));
    const category = await ensureCategory('IMPORTED SALES');

    const t = await sequelize.transaction();
    try {
        let insertedOrders = 0;
        let insertedOrderItems = 0;
        let createdCustomers = 0;
        let promotedToGold = 0;
        let createdProducts = 0;

        const userByNameLower = new Map<string, any>();
        const productByNameLower = new Map<string, any>();

        for (const invoice of invoices) {
            const customerName = invoice.customer_name.trim() || 'Customer';
            const customerKey = normalizeLower(customerName);

            let user = userByNameLower.get(customerKey);
            if (!user) {
                user = await User.findOne({
                    where: where(fn('lower', col('name')), customerKey),
                    transaction: t
                });
                if (!user) {
                    user = await User.create({
                        name: customerName,
                        email: null,
                        password: null,
                        whatsapp_number: null as any,
                        role: 'customer',
                        status: 'active',
                        debt: 0,
                    } as any, { transaction: t });
                    createdCustomers += 1;
                }
                userByNameLower.set(customerKey, user);
            }

            const invoiceHasDiscount = invoice.items.some((item) => Number(item.discount_amount || 0) > 0 || Number(item.discount_pct || 0) > 0) || Number(invoice.diskon || 0) > 0;

            const desiredTier = invoiceHasDiscount ? 'gold' : null;
            if (desiredTier) {
                const existingProfile = await CustomerProfile.findByPk(String(user.id), { transaction: t });
                if (!existingProfile) {
                    await CustomerProfile.create({
                        user_id: String(user.id),
                        tier: 'gold',
                        credit_limit: 0,
                        points: 0,
                        saved_addresses: []
                    }, { transaction: t });
                    promotedToGold += 1;
                } else if (existingProfile.tier !== 'gold') {
                    await existingProfile.update({ tier: 'gold' }, { transaction: t });
                    promotedToGold += 1;
                }
            } else {
                const existingProfile = await CustomerProfile.findByPk(String(user.id), { transaction: t });
                if (!existingProfile) {
                    await CustomerProfile.create({
                        user_id: String(user.id),
                        tier: 'regular',
                        credit_limit: 0,
                        points: 0,
                        saved_addresses: []
                    }, { transaction: t });
                }
            }

            const importedNote = `[Imported sales report] invoice=${invoice.invoice_no}`;
            const existingOrder = await Order.findOne({
                where: { customer_note: importedNote },
                transaction: t
            });

            const order = existingOrder || await Order.create({
                customer_id: String(user.id),
                customer_name: customerName,
                source: 'web',
                status: 'completed',
                payment_method: 'cash_store',
                total_amount: Number(invoice.netto || 0),
                discount_amount: Number(invoice.diskon || 0),
                shipping_method_code: null,
                shipping_method_name: null,
                shipping_fee: 0,
                shipping_address: null,
                customer_note: importedNote,
                expiry_date: null,
                stock_released: true,
                createdAt: invoice.date,
                updatedAt: invoice.date
            } as any, { transaction: t });
            if (!existingOrder) insertedOrders += 1;

            for (const item of invoice.items) {
                const name = item.product_name.trim();
                const productKey = normalizeLower(name);
                let product = productByNameLower.get(productKey);
                if (!product) {
                    product = await Product.findOne({
                        where: where(fn('lower', col('name')), productKey),
                        transaction: t
                    });
                    if (!product) {
                        product = await Product.create({
                            sku: generateSkuFromName(name),
                            barcode: null,
                            name,
                            description: null,
                            image_url: null,
                            base_price: Number(item.cost_per_unit || 0),
                            price: Number(item.price_per_unit || 0),
                            unit: 'Pcs',
                            stock_quantity: 0,
                            allocated_quantity: 0,
                            min_stock: 0,
                            category_id: category.id,
                            status: 'active',
                            keterangan: null,
                            tipe_modal: null,
                            varian_harga: null,
                            grosir: null,
                            total_modal: null
                        } as any, { transaction: t });
                        createdProducts += 1;
                    } else {
                        const patch: any = {};
                        if (Number(product.price || 0) <= 0 && Number(item.price_per_unit || 0) > 0) patch.price = Number(item.price_per_unit || 0);
                        if (Number(product.base_price || 0) <= 0 && Number(item.cost_per_unit || 0) > 0) patch.base_price = Number(item.cost_per_unit || 0);
                        if (Object.keys(patch).length > 0) await product.update(patch, { transaction: t });
                    }
                    productByNameLower.set(productKey, product);
                }

                const qty = Math.max(0, Number(item.qty || 0));
                const unitPaid = computeUnitPaid(invoice, item);
                const baseUnit = round2(Number(item.price_per_unit || 0));
                const discountPct = baseUnit > 0 ? round2(Math.min(100, Math.max(0, ((baseUnit - unitPaid) / baseUnit) * 100))) : 0;
                const assumedTier = invoiceHasDiscount && (Number(item.discount_amount || 0) > 0 || discountPct > 0) ? 'gold' : 'regular';

                const existingItem = await OrderItem.findOne({
                    where: {
                        order_id: String(order.id),
                        product_id: String(product.id)
                    },
                    transaction: t
                });
                if (existingItem) continue;

                await OrderItem.create({
                    order_id: String(order.id),
                    product_id: String(product.id),
                    qty,
                    ordered_qty_original: qty,
                    qty_canceled_backorder: 0,
                    price_at_purchase: unitPaid,
                    cost_at_purchase: Number(item.cost_per_unit || 0),
                    pricing_snapshot: {
                        tier: assumedTier,
                        base_price: baseUnit,
                        discount_pct: discountPct,
                        discount_source: (discountPct > 0) ? 'tier_fallback' : 'none',
                        note: item.note || null,
                        imported_invoice: invoice.invoice_no
                    }
                } as any, { transaction: t });
                insertedOrderItems += 1;
            }
        }

        await t.commit();
        return {
            source: 'seeders/data/sales_report_diskon_2026_03_24.ts',
            parsedInvoices: invoices.length,
            insertedOrders,
            insertedOrderItems,
            createdCustomers,
            promotedToGold,
            createdProducts
        };
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
};
