import crypto from 'crypto';
import { col, fn, where } from 'sequelize';
import { Account, Category, CustomerProfile, Invoice, InvoiceItem, Journal, Order, OrderItem, Product, User, sequelize } from '../models';
import { SalesReportInvoice } from './salesReportDiskonParser';
import { salesReportDiskonSeedInvoices } from './data/sales_report_diskon_2026_03_24';
import { JournalService } from '../services/JournalService';

type SeedPurchaseHistoryResult = {
    source: string;
    parsedInvoices: number;
    insertedOrders: number;
    insertedOrderItems: number;
    insertedInvoices: number;
    insertedInvoiceItems: number;
    insertedJournals: number;
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

const resolveSeedActorId = async (t: any): Promise<string> => {
    const preferredRoles = ['super_admin', 'admin_finance', 'kasir'];
    for (const role of preferredRoles) {
        const found = await User.findOne({ where: { role }, attributes: ['id'], transaction: t });
        const id = String((found as any)?.id || '').trim();
        if (id) return id;
    }
    const fallback = await User.findOne({ attributes: ['id'], transaction: t });
    const fallbackId = String((fallback as any)?.id || '').trim();
    if (!fallbackId) throw new Error('No users exist to attribute seeded journal entries (created_by).');
    return fallbackId;
};

const getAccountIdByCode = async (code: string, t: any): Promise<number> => {
    const row = await Account.findOne({ where: { code }, attributes: ['id'], transaction: t });
    const idRaw = (row as any)?.id;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) throw new Error(`Account code '${code}' not found (required for journal seeding).`);
    return id;
};

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
        let insertedInvoices = 0;
        let insertedInvoiceItems = 0;
        let insertedJournals = 0;
        let createdCustomers = 0;
        let promotedToGold = 0;
        let createdProducts = 0;

        const seedActorId = await resolveSeedActorId(t);
        const kasAccountId = await getAccountIdByCode('1101', t);
        const revenueAccountId = await getAccountIdByCode('4100', t);
        const hppAccountId = await getAccountIdByCode('5100', t);
        const inventoryAccountId = await getAccountIdByCode('1300', t);

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

            let invoiceCogs = 0;
            let invoiceRow = await Invoice.findOne({
                where: { invoice_number: String(invoice.invoice_no || '').trim() },
                transaction: t
            });
            if (!invoiceRow) {
                invoiceRow = await Invoice.create({
                    order_id: String(order.id),
                    customer_id: String(user.id),
                    invoice_number: String(invoice.invoice_no || '').trim(),
                    payment_method: 'cash_store',
                    payment_status: 'paid',
                    amount_paid: Number(invoice.netto || 0),
                    change_amount: 0,
                    payment_proof_url: null,
                    verified_by: null,
                    verified_at: invoice.date,
                    subtotal: Number(invoice.bruto || 0),
                    discount_amount: Number(invoice.diskon || 0),
                    shipping_fee_total: 0,
                    tax_percent: 0,
                    tax_amount: 0,
                    total: Number(invoice.netto || 0),
                    tax_mode_snapshot: 'non_pkp',
                    pph_final_amount: null,
                    shipping_method_code: null,
                    shipping_method_name: null,
                    courier_id: null,
                    shipment_status: 'delivered',
                    shipped_at: invoice.date,
                    delivered_at: invoice.date,
                    delivery_proof_url: null,
                    expiry_date: null,
                    createdAt: invoice.date,
                    updatedAt: invoice.date
                } as any, { transaction: t });
                insertedInvoices += 1;
            } else {
                const patch: any = {};
                if (!invoiceRow.order_id) patch.order_id = String(order.id);
                if (!invoiceRow.customer_id) patch.customer_id = String(user.id);
                if (Object.keys(patch).length > 0) await invoiceRow.update(patch, { transaction: t });
            }

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
                if (qty <= 0) continue;
                const unitPaid = computeUnitPaid(invoice, item);
                const baseUnit = round2(Number(item.price_per_unit || 0));
                const discountPct = baseUnit > 0 ? round2(Math.min(100, Math.max(0, ((baseUnit - unitPaid) / baseUnit) * 100))) : 0;
                const assumedTier = invoiceHasDiscount && (Number(item.discount_amount || 0) > 0 || discountPct > 0) ? 'gold' : 'regular';
                invoiceCogs += Number(item.cost_per_unit || 0) * qty;

                let orderItem = await OrderItem.findOne({
                    where: {
                        order_id: String(order.id),
                        product_id: String(product.id)
                    },
                    transaction: t
                });
                if (!orderItem) {
                    orderItem = await OrderItem.create({
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

                const existingInvoiceItem = await InvoiceItem.findOne({
                    where: {
                        invoice_id: String(invoiceRow.id),
                        order_item_id: String(orderItem.id)
                    },
                    transaction: t
                });
                if (existingInvoiceItem) continue;

                await InvoiceItem.create({
                    invoice_id: String(invoiceRow.id),
                    order_item_id: String(orderItem.id),
                    qty,
                    unit_price: unitPaid,
                    unit_cost: Number(item.cost_per_unit || 0),
                    line_total: round2(unitPaid * qty)
                } as any, { transaction: t });
                insertedInvoiceItems += 1;
            }

            // Create a balanced journal entry so finance reports (P&L, etc.) can show seeded sales.
            // Idempotent by invoice number.
            const revenue = round2(Number(invoice.netto || 0));
            const cogs = round2(Number(invoiceCogs || 0));
            const idempotencyKey = `seed_sales_report_${String(invoice.invoice_no || '').trim()}`;
            const existingJournal = await Journal.findOne({
                where: { idempotency_key: idempotencyKey },
                attributes: ['id'],
                transaction: t
            });
            if (!existingJournal) {
                insertedJournals += 1;
            }
            await JournalService.createEntry({
                date: invoice.date,
                description: `Seed sales report invoice ${invoice.invoice_no}`,
                reference_type: 'seed_sales_report',
                reference_id: String(invoice.invoice_no || ''),
                created_by: seedActorId,
                idempotency_key: idempotencyKey,
                lines: [
                    { account_id: kasAccountId, debit: revenue, credit: 0 },
                    { account_id: revenueAccountId, debit: 0, credit: revenue },
                    { account_id: hppAccountId, debit: cogs, credit: 0 },
                    { account_id: inventoryAccountId, debit: 0, credit: cogs },
                ]
            }, t);
        }

        await t.commit();
        return {
            source: 'seeders/data/sales_report_diskon_2026_03_24.ts',
            parsedInvoices: invoices.length,
            insertedOrders,
            insertedOrderItems,
            insertedInvoices,
            insertedInvoiceItems,
            insertedJournals,
            createdCustomers,
            promotedToGold,
            createdProducts
        };
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
};
