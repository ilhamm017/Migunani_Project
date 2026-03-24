import crypto from 'crypto';
import { Op, col, fn, where } from 'sequelize';
import { Backorder, Category, Order, OrderAllocation, OrderItem, Product, User, sequelize } from '../models';
import { salesReportBackorderSeedInvoices, SalesReportBackorderSeedInvoice } from './data/sales_report_backorder_2026_03_24';

type SeedBackorderHistoryResult = {
    source: string;
    parsedInvoices: number;
    insertedOrders: number;
    insertedOrderItems: number;
    insertedBackorders: number;
    insertedAllocations: number;
    missingCustomers: string[];
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

const computeUnitPaid = (item: SalesReportBackorderSeedInvoice['items'][number]): number => {
    const qtyRequested = Math.max(1, Number(item.qty_requested || 0));
    if (Number(item.subtotal || 0) > 0) return round2(Number(item.subtotal) / qtyRequested);
    if (Number(item.discount_amount || 0) > 0 && Number(item.price_per_unit || 0) > 0) {
        return round2(Math.max(0, Number(item.price_per_unit) - (Number(item.discount_amount) / qtyRequested)));
    }
    return round2(Number(item.price_per_unit || 0));
};

const computeDiscountPctFallback = (item: SalesReportBackorderSeedInvoice['items'][number]): number => {
    const baseUnit = round2(Number(item.price_per_unit || 0));
    const unitPaid = computeUnitPaid(item);
    return baseUnit > 0 ? round2(Math.min(100, Math.max(0, ((baseUnit - unitPaid) / baseUnit) * 100))) : 0;
};

export const seedPurchaseHistoryFromBackorderReport = async (options?: {
    invoices?: SalesReportBackorderSeedInvoice[];
    createMissingCustomers?: boolean;
}): Promise<SeedBackorderHistoryResult> => {
    const rawInvoices = options?.invoices || salesReportBackorderSeedInvoices;
    const invoices: Array<SalesReportBackorderSeedInvoice & { parsed_date: Date }> = rawInvoices.map((inv) => ({
        ...inv,
        parsed_date: new Date(inv.date),
    }));

    const category = await ensureCategory('IMPORTED SALES');

    const t = await sequelize.transaction();
    try {
        let insertedOrders = 0;
        let insertedOrderItems = 0;
        let insertedBackorders = 0;
        let insertedAllocations = 0;
        let createdProducts = 0;
        const missingCustomersSet = new Set<string>();

        const userByNameLower = new Map<string, any>();
        const productByNameLower = new Map<string, any>();

        for (const invoice of invoices) {
            const customerName = String(invoice.customer_name || '').trim() || 'Customer';
            const customerKey = normalizeLower(customerName);

            let user = userByNameLower.get(customerKey);
            if (!user) {
                user = await User.findOne({
                    where: where(fn('lower', col('name')), customerKey),
                    transaction: t
                });
                if (!user) {
                    missingCustomersSet.add(customerName);
                    if (options?.createMissingCustomers) {
                        user = await User.create({
                            name: customerName,
                            email: null,
                            password: null,
                            whatsapp_number: null as any,
                            role: 'customer',
                            status: 'active',
                            debt: 0,
                        } as any, { transaction: t });
                    } else {
                        continue;
                    }
                }
                userByNameLower.set(customerKey, user);
            }

            const requestedTotalQty = invoice.items.reduce((sum, it) => sum + Math.max(0, Number(it.qty_requested || 0)), 0);
            const displayTotalQty = invoice.items.reduce((sum, it) => sum + Math.max(0, Number(it.qty_display || 0)), 0);
            const backorderTotalQty = invoice.items.reduce((sum, it) => sum + Math.max(0, Number(it.backorder_qty || 0)), 0);
            const hasBackorder = backorderTotalQty > 0;

            const importedNoteBase = `[Imported sales backorder report] invoice=${invoice.invoice_no}`;
            const importedNote = `${importedNoteBase} requested_qty=${requestedTotalQty} display_qty=${displayTotalQty} backorder_qty=${backorderTotalQty}`;
            const existingOrder = await Order.findOne({
                where: {
                    customer_note: { [Op.like]: `${importedNoteBase}%` }
                },
                transaction: t
            });

            const order = existingOrder || await Order.create({
                customer_id: String(user.id),
                customer_name: customerName,
                source: 'web',
                status: hasBackorder ? 'partially_fulfilled' : 'completed',
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
                createdAt: invoice.parsed_date,
                updatedAt: invoice.parsed_date
            } as any, { transaction: t });
            if (!existingOrder) insertedOrders += 1;
            if (existingOrder) continue;

            const allocatedQtyByProductId = new Map<string, number>();

            for (const item of invoice.items) {
                const name = String(item.product_name || '').trim();
                if (!name) continue;
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

                const qtyRequested = Math.max(0, Number(item.qty_requested || 0));
                const qtyDisplay = Math.max(0, Number(item.qty_display || 0));
                const boQty = Math.max(0, Number(item.backorder_qty || 0) || Math.max(0, qtyRequested - qtyDisplay));

                const unitPaid = computeUnitPaid(item);
                const baseUnit = round2(Number(item.price_per_unit || 0));
                const discountPct = Number(item.discount_pct || 0) > 0 ? Number(item.discount_pct || 0) : computeDiscountPctFallback(item);

                const orderItem = await OrderItem.create({
                    order_id: String(order.id),
                    product_id: String(product.id),
                    qty: qtyRequested,
                    ordered_qty_original: qtyRequested,
                    qty_canceled_backorder: 0,
                    price_at_purchase: unitPaid,
                    cost_at_purchase: Number(item.cost_per_unit || 0),
                    pricing_snapshot: {
                        imported_invoice: invoice.invoice_no,
                        qty_requested: qtyRequested,
                        qty_display: qtyDisplay,
                        backorder_qty: boQty,
                        base_price: baseUnit,
                        discount_pct: discountPct,
                        note: item.note || null,
                    },
                    createdAt: invoice.parsed_date,
                    updatedAt: invoice.parsed_date
                } as any, { transaction: t });
                insertedOrderItems += 1;

                if (boQty > 0) {
                    await Backorder.create({
                        order_item_id: String(orderItem.id),
                        qty_pending: boQty,
                        status: 'waiting_stock',
                        notes: `[Imported sales backorder report] invoice=${invoice.invoice_no} qty_display=${qtyDisplay} qty_requested=${qtyRequested}`,
                        createdAt: invoice.parsed_date,
                        updatedAt: invoice.parsed_date
                    } as any, { transaction: t, silent: true });
                    insertedBackorders += 1;
                }

                if (qtyDisplay > 0) {
                    const prev = allocatedQtyByProductId.get(String(product.id)) || 0;
                    allocatedQtyByProductId.set(String(product.id), prev + qtyDisplay);
                }
            }

            for (const [productId, allocatedQty] of allocatedQtyByProductId.entries()) {
                if (allocatedQty <= 0) continue;
                await OrderAllocation.create({
                    order_id: String(order.id),
                    product_id: String(productId),
                    allocated_qty: allocatedQty,
                    status: 'shipped',
                    shipped_at: invoice.parsed_date,
                    picked_at: invoice.parsed_date,
                    createdAt: invoice.parsed_date,
                    updatedAt: invoice.parsed_date
                } as any, { transaction: t });
                insertedAllocations += 1;
            }
        }

        await t.commit();
        return {
            source: 'seeders/data/sales_report_backorder_2026_03_24.ts',
            parsedInvoices: invoices.length,
            insertedOrders,
            insertedOrderItems,
            insertedBackorders,
            insertedAllocations,
            missingCustomers: Array.from(missingCustomersSet.values()).sort((a, b) => a.localeCompare(b)),
            createdProducts
        };
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
};
