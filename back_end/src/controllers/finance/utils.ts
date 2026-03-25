import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting } from '../../models';
import { Op } from 'sequelize';
import { JournalService } from '../../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../../utils/orderNotification';
import { generateInvoiceNumber } from '../../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';


export type ExpenseDetail = {
    key: string;
    value: string;
};

export type ParsedExpenseNote = {
    text: string;
    details: ExpenseDetail[];
};

const DEFAULT_EXPENSE_LABELS = [
    { name: 'Listrik', description: 'Tagihan listrik dan utilitas' },
    { name: 'Gaji Pegawai', description: 'Payroll dan tunjangan karyawan' },
    { name: 'Ongkir', description: 'Biaya pengiriman atau logistik' },
];

export const toSafeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

export const normalizeExpenseDetails = (details: unknown): ExpenseDetail[] => {
    if (!Array.isArray(details)) return [];

    return details
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const raw = item as { key?: unknown; value?: unknown };
            const key = toSafeText(raw.key);
            const value = toSafeText(raw.value);
            if (!key && !value) return null;
            return { key, value };
        })
        .filter((item): item is ExpenseDetail => item !== null);
};

export const parseExpenseNote = (note: unknown): ParsedExpenseNote => {
    const fallbackText = typeof note === 'string' ? note : '';
    if (typeof note !== 'string' || !note.trim()) {
        return { text: fallbackText, details: [] };
    }

    try {
        const parsed = JSON.parse(note) as { text?: unknown; details?: unknown };
        return {
            text: toSafeText(parsed.text),
            details: normalizeExpenseDetails(parsed.details),
        };
    } catch {
        return { text: note, details: [] };
    }
};

export const buildExpenseNote = (note: unknown, details: unknown): string => {
    const text = toSafeText(note);
    const normalizedDetails = normalizeExpenseDetails(details);
    if (!text && normalizedDetails.length === 0) {
        return '';
    }
    return JSON.stringify({ text, details: normalizedDetails });
};

export const ensureDefaultExpenseLabels = async () => {
    const labelCount = await ExpenseLabel.count();
    if (labelCount > 0) return;

    const expenseCount = await Expense.count();
    if (expenseCount > 0) return;

    for (const item of DEFAULT_EXPENSE_LABELS) {
        await ExpenseLabel.findOrCreate({
            where: { name: item.name },
            defaults: item
        });
    }
};

export const genCreditNoteNumber = () => `CN-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

export const normalizeTaxNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

export const buildAccountsReceivableInclude = () => ([
    {
        model: User,
        as: 'Verifier',
        attributes: ['id', 'name', 'email'],
        required: false
    }
]);

export const buildAccountsReceivableContext = async (invoices: Invoice[]) => {
    const invoiceIds = invoices.map((inv) => String(inv.id));
    const itemsByInvoiceId = new Map<string, any[]>();
    const orderIdsByInvoiceId = new Map<string, Set<string>>();

    if (invoiceIds.length === 0) {
        return {
            itemsByInvoiceId,
            orderIdsByInvoiceId,
            primaryOrderByInvoiceId: new Map<string, any>(),
            ordersById: new Map<string, any>()
        };
    }

    const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: { [Op.in]: invoiceIds } },
        include: [{
            model: OrderItem,
            attributes: ['id', 'order_id', 'price_at_purchase', 'cost_at_purchase', 'product_id'],
            include: [{
                model: Product,
                attributes: ['id', 'sku', 'name'],
                required: false
            }],
            required: false
        }]
    });

    invoiceItems.forEach((item: any) => {
        const invoiceId = String(item.invoice_id);
        const orderItem = item.OrderItem;
        const orderId = orderItem?.order_id ? String(orderItem.order_id) : '';
        if (orderId) {
            const set = orderIdsByInvoiceId.get(invoiceId) || new Set<string>();
            set.add(orderId);
            orderIdsByInvoiceId.set(invoiceId, set);
        }

        const qty = Number(item.qty || 0);
        const unitPrice = Number(item.unit_price || orderItem?.price_at_purchase || 0);
        const subtotal = Number(item.line_total || unitPrice * qty);
        const items = itemsByInvoiceId.get(invoiceId) || [];
        items.push({
            id: orderItem?.id || item.id,
            qty,
            price_at_purchase: unitPrice,
            cost_at_purchase: Number(item.unit_cost || orderItem?.cost_at_purchase || 0),
            subtotal,
            product: orderItem?.Product ? {
                id: orderItem.Product.id,
                sku: orderItem.Product.sku,
                name: orderItem.Product.name
            } : null
        });
        itemsByInvoiceId.set(invoiceId, items);
    });

    const orderIds = Array.from(new Set(
        Array.from(orderIdsByInvoiceId.values()).flatMap((set) => Array.from(set))
    ));
    const orders = orderIds.length > 0
        ? await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            include: [
                {
                    model: User,
                    as: 'Customer',
                    attributes: ['id', 'name', 'email', 'whatsapp_number'],
                    required: false
                },
                {
                    model: User,
                    as: 'Courier',
                    attributes: ['id', 'name', 'whatsapp_number'],
                    required: false
                }
            ]
        })
        : [];

    const ordersById = new Map<string, any>();
    orders.forEach((order: any) => {
        ordersById.set(String(order.id), order.get({ plain: true }));
    });

    const primaryOrderByInvoiceId = new Map<string, any>();
    invoiceIds.forEach((invoiceId) => {
        const relatedIds = Array.from(orderIdsByInvoiceId.get(invoiceId) || []);
        let selectedId = relatedIds.find((id) => {
            const order = ordersById.get(id);
            const status = String(order?.status || '');
            return status && !['canceled', 'expired'].includes(status);
        });
        if (!selectedId) selectedId = relatedIds[0];
        const primary = selectedId ? ordersById.get(selectedId) || null : null;
        primaryOrderByInvoiceId.set(invoiceId, primary);
    });

    return {
        itemsByInvoiceId,
        orderIdsByInvoiceId,
        primaryOrderByInvoiceId,
        ordersById
    };
};

export const mapAccountsReceivableRows = (
    invoices: Invoice[],
    context: {
        itemsByInvoiceId: Map<string, any[]>;
        orderIdsByInvoiceId: Map<string, Set<string>>;
        primaryOrderByInvoiceId: Map<string, any>;
        ordersById: Map<string, any>;
    },
    options?: {
        collectible_total_by_invoice_id?: Map<string, number>;
    }
) => {
    const normalizeMethod = (value: unknown) => String(value || '').trim().toLowerCase();
    const nowMs = Date.now();
    return invoices.map((invoice) => {
        const plainInvoice = invoice.get({ plain: true }) as any;
        const invoiceId = String(plainInvoice.id);
        const order = context.primaryOrderByInvoiceId.get(invoiceId) || {};
        const customer = order.Customer || null;
        const courier = order.Courier || null;
        const verifier = plainInvoice.Verifier || null;
        const items = context.itemsByInvoiceId.get(invoiceId) || [];

        const relatedOrderIds = context.orderIdsByInvoiceId.get(invoiceId);
        if (relatedOrderIds && relatedOrderIds.size > 0) {
            const hasActiveOrder = Array.from(relatedOrderIds).some((id) => {
                const candidate = context.ordersById.get(id);
                const status = String(candidate?.status || '');
                return status && !['canceled', 'expired'].includes(status);
            });
            if (!hasActiveOrder) {
                return null;
            }

            // Exclude invoices that are no longer relevant because all related orders have
            // moved to a different payment method (common when invoice got superseded).
            const invoiceMethod = normalizeMethod(plainInvoice.payment_method);
            if (['transfer_manual', 'cod', 'cash_store'].includes(invoiceMethod)) {
                const relatedOrders = Array.from(relatedOrderIds)
                    .map((id) => context.ordersById.get(id))
                    .filter(Boolean);
                const orderMethods = relatedOrders
                    .map((row) => normalizeMethod(row?.payment_method))
                    .filter(Boolean);
                const hasMethodInfo = orderMethods.length > 0;
                const hasMatch = orderMethods.some((m) => m === invoiceMethod);
                if (hasMethodInfo && !hasMatch) {
                    return null;
                }
            }
        }

        const orderCreatedAtRaw = order.createdAt || plainInvoice.createdAt;
        const orderCreatedAtMs = orderCreatedAtRaw ? new Date(orderCreatedAtRaw).getTime() : nowMs;
        const agingDays = Math.max(0, Math.floor((nowMs - orderCreatedAtMs) / (24 * 60 * 60 * 1000)));

        const collectible = options?.collectible_total_by_invoice_id?.get(invoiceId);
        const totalAmount = Number(
            (Number.isFinite(Number(collectible)) && Number(collectible) >= 0)
                ? collectible
                : (plainInvoice.total || order.total_amount || 0)
        );
        const amountPaid = Number(plainInvoice.amount_paid || 0);
        const amountDue = Math.max(0, totalAmount - amountPaid);

        return {
            id: plainInvoice.id,
            invoice_number: plainInvoice.invoice_number,
            payment_method: plainInvoice.payment_method,
            payment_status: plainInvoice.payment_status,
            payment_proof_url: plainInvoice.payment_proof_url,
            amount_paid: amountPaid,
            change_amount: Number(plainInvoice.change_amount || 0),
            createdAt: plainInvoice.createdAt,
            updatedAt: plainInvoice.updatedAt,
            verified_at: plainInvoice.verified_at,
            aging_days: agingDays,
            amount_due: amountDue,
            order: {
                id: order.id || null,
                customer_id: order.customer_id || plainInvoice.customer_id || null,
                customer_name: order.customer_name || customer?.name || 'Customer',
                source: order.source || null,
                status: order.status || null,
                total_amount: totalAmount,
                createdAt: order.createdAt || null,
                updatedAt: order.updatedAt || null,
                expiry_date: order.expiry_date || null,
                customer: customer ? {
                    id: customer.id,
                    name: customer.name,
                    email: customer.email,
                    whatsapp_number: customer.whatsapp_number
                } : null,
                courier: courier ? {
                    id: courier.id,
                    name: courier.name,
                    whatsapp_number: courier.whatsapp_number
                } : null,
                items
            },
            verifier: verifier ? {
                id: verifier.id,
                name: verifier.name,
                email: verifier.email
            } : null
        };
    }).filter(Boolean);
};
