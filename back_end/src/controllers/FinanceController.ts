import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting } from '../models';
import { Op } from 'sequelize';
import { JournalService } from '../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../services/TaxConfigService';
import { AccountingPostingService } from '../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../utils/orderNotification';
import { generateInvoiceNumber } from '../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../utils/invoiceLookup';


type ExpenseDetail = {
    key: string;
    value: string;
};

type ParsedExpenseNote = {
    text: string;
    details: ExpenseDetail[];
};

const DEFAULT_EXPENSE_LABELS = [
    { name: 'Listrik', description: 'Tagihan listrik dan utilitas' },
    { name: 'Gaji Pegawai', description: 'Payroll dan tunjangan karyawan' },
    { name: 'Ongkir', description: 'Biaya pengiriman atau logistik' },
];

const toSafeText = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim();
};

const normalizeExpenseDetails = (details: unknown): ExpenseDetail[] => {
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

const parseExpenseNote = (note: unknown): ParsedExpenseNote => {
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

const buildExpenseNote = (note: unknown, details: unknown): string => {
    const text = toSafeText(note);
    const normalizedDetails = normalizeExpenseDetails(details);
    if (!text && normalizedDetails.length === 0) {
        return '';
    }
    return JSON.stringify({ text, details: normalizedDetails });
};

const ensureDefaultExpenseLabels = async () => {
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

const genCreditNoteNumber = () => `CN-${Date.now()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

const normalizeTaxNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
};

const buildAccountsReceivableInclude = () => ([
    {
        model: User,
        as: 'Verifier',
        attributes: ['id', 'name', 'email'],
        required: false
    }
]);

const buildAccountsReceivableContext = async (invoices: Invoice[]) => {
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
    orders.forEach((order) => {
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

const mapAccountsReceivableRows = (
    invoices: Invoice[],
    context: {
        itemsByInvoiceId: Map<string, any[]>;
        orderIdsByInvoiceId: Map<string, Set<string>>;
        primaryOrderByInvoiceId: Map<string, any>;
        ordersById: Map<string, any>;
    }
) => {
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
        }

        const orderCreatedAtRaw = order.createdAt || plainInvoice.createdAt;
        const orderCreatedAtMs = orderCreatedAtRaw ? new Date(orderCreatedAtRaw).getTime() : nowMs;
        const agingDays = Math.max(0, Math.floor((nowMs - orderCreatedAtMs) / (24 * 60 * 60 * 1000)));

        const totalAmount = Number(plainInvoice.total || order.total_amount || 0);
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

const issueInvoiceForOrders = async (orderIds: string[], req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya kasir atau super admin yang boleh menerbitkan invoice' });
        }

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'order_ids wajib diisi' });
        }

        const orders = await Order.findAll({
            where: { id: { [Op.in]: orderIds } },
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orders.length !== orderIds.length) {
            await t.rollback();
            return res.status(404).json({ message: 'Beberapa order tidak ditemukan' });
        }

        const primaryOrder = orders[0] as any;
        const customerId = String(primaryOrder.customer_id || '');
        const paymentMethod = String(primaryOrder.payment_method || '');

        if (!['transfer_manual', 'cod', 'cash_store'].includes(paymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran order belum ditentukan.' });
        }

        for (const order of orders as any[]) {
            if (String(order.status || '') !== 'waiting_invoice') {
                await t.rollback();
                return res.status(400).json({ message: `Order ${order.id} status '${order.status}' tidak bisa diterbitkan invoice.` });
            }
            if (String(order.customer_id || '') !== customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Order harus dari customer yang sama.' });
            }
            if (String(order.payment_method || '') !== paymentMethod) {
                await t.rollback();
                return res.status(400).json({ message: 'Metode pembayaran harus sama untuk invoice gabungan.' });
            }
        }

        const orderItemIds = orders
            .flatMap((order: any) => Array.isArray(order.OrderItems) ? order.OrderItems : [])
            .map((item: any) => String(item.id))
            .filter(Boolean);
        const priorInvoiceItems = orderItemIds.length > 0
            ? await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIds } },
                transaction: t
            })
            : [];
        const invoicedQtyByOrderItemId = new Map<string, number>();
        priorInvoiceItems.forEach((item: any) => {
            const key = String(item.order_item_id);
            const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
            invoicedQtyByOrderItemId.set(key, prev + Number(item.qty || 0));
        });

        const invoiceNumber = generateInvoiceNumber(primaryOrder.id);
        const itemsPayload: any[] = [];
        let itemsSubtotal = 0;
        let discountTotal = 0;
        let shippingFeeTotal = 0;
        const ordersWithoutInvoiceLines: string[] = [];

        for (const order of orders as any[]) {
            const orderItems = Array.isArray(order.OrderItems) ? order.OrderItems : [];
            const allocations = Array.isArray(order.Allocations) ? order.Allocations : [];
            const allocatedByProduct = new Map<string, number>();
            allocations.forEach((allocation: any) => {
                const key = String(allocation?.product_id || '');
                if (!key) return;
                allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(allocation?.allocated_qty || 0));
            });

            const orderItemsByProduct = new Map<string, any[]>();
            orderItems.forEach((item: any) => {
                const key = String(item?.product_id || '');
                if (!key) return;
                const list = orderItemsByProduct.get(key) || [];
                list.push(item);
                orderItemsByProduct.set(key, list);
            });

            let orderInvoiceSubtotal = 0;
            let orderSubtotalFull = 0;
            orderItems.forEach((item: any) => {
                const qty = Number(item.qty || 0);
                const price = Number(item.price_at_purchase || 0);
                orderSubtotalFull += Math.round(price * qty * 100) / 100;
            });

            orderItemsByProduct.forEach((itemsForProduct, productId) => {
                let remainingAlloc = Number(allocatedByProduct.get(productId) || 0);
                const sortedItems = [...itemsForProduct].sort((a, b) => {
                    const aId = Number(a.id);
                    const bId = Number(b.id);
                    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                    return String(a.id).localeCompare(String(b.id));
                });

                for (const item of sortedItems) {
                    if (remainingAlloc <= 0) break;
                    const orderedQty = Number(item.qty || 0);
                    if (orderedQty <= 0) continue;

                    const allocQty = Math.min(remainingAlloc, orderedQty);
                    remainingAlloc -= allocQty;

                    const alreadyInvoiced = Number(invoicedQtyByOrderItemId.get(String(item.id)) || 0);
                    const qtyToInvoice = Math.max(0, allocQty - alreadyInvoiced);
                    if (qtyToInvoice <= 0) continue;

                    const price = Number(item.price_at_purchase || 0);
                    const cost = Number(item.cost_at_purchase || 0);
                    const lineTotal = Math.round(price * qtyToInvoice * 100) / 100;
                    itemsSubtotal += lineTotal;
                    orderInvoiceSubtotal += lineTotal;
                    itemsPayload.push({
                        order_item_id: item.id,
                        qty: qtyToInvoice,
                        unit_price: price,
                        unit_cost: cost,
                        line_total: lineTotal
                    });
                }
            });

            if (orderInvoiceSubtotal <= 0) {
                ordersWithoutInvoiceLines.push(String(order.id));
                continue;
            }

            const ratio = orderSubtotalFull > 0 ? (orderInvoiceSubtotal / orderSubtotalFull) : 0;
            const orderDiscount = Number(order.discount_amount || 0) * ratio;
            const orderShipping = Number(order.shipping_fee || 0) * ratio;
            discountTotal += Math.round(orderDiscount * 100) / 100;
            shippingFeeTotal += Math.round(orderShipping * 100) / 100;
        }

        if (ordersWithoutInvoiceLines.length > 0) {
            await t.rollback();
            return res.status(400).json({
                message: `Order berikut belum memiliki alokasi untuk ditagihkan: ${ordersWithoutInvoiceLines.join(', ')}`
            });
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item teralokasi untuk diterbitkan invoice.' });
        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const paymentStatus = paymentMethod === 'cod' || paymentMethod === 'cash_store'
            ? 'cod_pending'
            : 'unpaid';

        const invoice = await Invoice.create({
            order_id: primaryOrder.id,
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: paymentMethod as any,
            payment_status: paymentStatus,
            amount_paid: 0,
            change_amount: 0,
            subtotal: subtotalBase,
            discount_amount: discountTotal,
            shipping_fee_total: shippingFeeTotal,
            tax_percent: computedTax.tax_percent,
            tax_amount: computedTax.tax_amount,
            total: computedTax.total,
            tax_mode_snapshot: computedTax.tax_mode_snapshot,
            pph_final_amount: computedTax.pph_final_amount
        }, { transaction: t });

        await InvoiceItem.bulkCreate(
            itemsPayload.map((payload) => ({
                ...payload,
                invoice_id: invoice.id
            })),
            { transaction: t }
        );

        const nextStatus = 'ready_to_ship';
        const expiryDate = null;

        await Order.update(
            {
                status: nextStatus,
                expiry_date: expiryDate
            },
            { where: { id: { [Op.in]: orderIds } }, transaction: t }
        );

        await t.commit();

        for (const order of orders as any[]) {
            const prevStatus = String(order.status || '');
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(paymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                });
            }
        }

        return res.json({
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        });
    } catch (error) {
        await t.rollback();
        return res.status(500).json({ message: 'Gagal menerbitkan invoice', error });
    }
};

// --- Issue Invoice (Kasir step: waiting_invoice → ready_to_ship) ---
export const issueInvoice = async (req: Request, res: Response) => {
    const { id } = req.params; // Order ID
    return issueInvoiceForOrders([String(id)], req, res);
};

export const issueInvoiceBatch = async (req: Request, res: Response) => {
    const orderIds = Array.isArray(req.body?.order_ids)
        ? req.body.order_ids.map((value: unknown) => String(value)).filter(Boolean)
        : [];
    return issueInvoiceForOrders(orderIds, req, res);
};

export const issueInvoiceByItems = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const userRole = req.user!.role;
        if (!['kasir', 'super_admin'].includes(userRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya kasir atau super admin yang boleh menerbitkan invoice' });
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const requestedItemsRaw = rawItems
            .map((item: any) => ({
                order_item_id: String(item?.order_item_id || ''),
                qty: Number(item?.qty || 0)
            }))
            .filter((item: any) => item.order_item_id && Number.isFinite(item.qty) && item.qty > 0);

        const requestedItemsMap = new Map<string, number>();
        requestedItemsRaw.forEach((item: any) => {
            const prev = Number(requestedItemsMap.get(item.order_item_id) || 0);
            requestedItemsMap.set(item.order_item_id, prev + Number(item.qty || 0));
        });
        const requestedItems = Array.from(requestedItemsMap.entries()).map(([order_item_id, qty]) => ({
            order_item_id,
            qty
        }));

        if (requestedItems.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'items wajib diisi' });
        }

        const orderItemIds = Array.from(new Set(requestedItems.map((item: any) => item.order_item_id)));
        const orderItems = await OrderItem.findAll({
            where: { id: { [Op.in]: orderItemIds } },
            include: [{ model: Order }],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (orderItems.length !== orderItemIds.length) {
            await t.rollback();
            return res.status(404).json({ message: 'Beberapa item order tidak ditemukan' });
        }

        const orderItemById = new Map<string, any>();
        const orderIds = new Set<string>();
        let customerId = '';
        let paymentMethod = '';

        for (const item of orderItems as any[]) {
            const order = item.Order;
            if (!order) {
                await t.rollback();
                return res.status(404).json({ message: 'Order untuk item tidak ditemukan' });
            }
            const nextCustomerId = String(order.customer_id || '');
            if (!customerId) customerId = nextCustomerId;
            if (nextCustomerId !== customerId) {
                await t.rollback();
                return res.status(400).json({ message: 'Semua item harus berasal dari customer yang sama.' });
            }

            const nextPaymentMethod = String(order.payment_method || '');
            if (!paymentMethod) paymentMethod = nextPaymentMethod;
            if (nextPaymentMethod !== paymentMethod) {
                await t.rollback();
                return res.status(400).json({ message: 'Metode pembayaran harus sama untuk invoice gabungan.' });
            }

            if (['canceled', 'expired', 'completed'].includes(String(order.status || ''))) {
                await t.rollback();
                return res.status(400).json({ message: `Order ${order.id} sudah selesai atau dibatalkan.` });
            }

            orderItemById.set(String(item.id), item);
            orderIds.add(String(order.id));
        }

        if (!['transfer_manual', 'cod', 'cash_store'].includes(paymentMethod)) {
            await t.rollback();
            return res.status(400).json({ message: 'Metode pembayaran order belum ditentukan.' });
        }

        const orders = await Order.findAll({
            where: { id: { [Op.in]: Array.from(orderIds) } },
            include: [
                { model: OrderItem },
                { model: OrderAllocation, as: 'Allocations' }
            ],
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        const priorInvoiceItems = await InvoiceItem.findAll({
            where: { order_item_id: { [Op.in]: orderItemIds } },
            transaction: t
        });
        const invoicedQtyByOrderItemId = new Map<string, number>();
        priorInvoiceItems.forEach((item: any) => {
            const key = String(item.order_item_id);
            const prev = Number(invoicedQtyByOrderItemId.get(key) || 0);
            invoicedQtyByOrderItemId.set(key, prev + Number(item.qty || 0));
        });

        const availabilityByOrderItemId = new Map<string, number>();
        const orderFullSubtotalById = new Map<string, number>();

        for (const order of orders as any[]) {
            const orderItemsList = Array.isArray(order.OrderItems) ? order.OrderItems : [];
            const allocations = Array.isArray(order.Allocations) ? order.Allocations : [];

            const allocatedByProduct = new Map<string, number>();
            allocations.forEach((allocation: any) => {
                const key = String(allocation?.product_id || '');
                if (!key) return;
                allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(allocation?.allocated_qty || 0));
            });

            const orderItemsByProduct = new Map<string, any[]>();
            let orderSubtotalFull = 0;
            orderItemsList.forEach((item: any) => {
                const qty = Number(item.qty || 0);
                const price = Number(item.price_at_purchase || 0);
                orderSubtotalFull += Math.round(price * qty * 100) / 100;

                const key = String(item?.product_id || '');
                if (!key) return;
                const list = orderItemsByProduct.get(key) || [];
                list.push(item);
                orderItemsByProduct.set(key, list);
            });
            orderFullSubtotalById.set(String(order.id), orderSubtotalFull);

            orderItemsByProduct.forEach((itemsForProduct, productId) => {
                let remainingAlloc = Number(allocatedByProduct.get(productId) || 0);
                const sortedItems = [...itemsForProduct].sort((a, b) => {
                    const aId = Number(a.id);
                    const bId = Number(b.id);
                    if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
                    return String(a.id).localeCompare(String(b.id));
                });

                for (const item of sortedItems) {
                    const orderedQty = Number(item.qty || 0);
                    const allocQty = Math.min(remainingAlloc, orderedQty);
                    remainingAlloc -= allocQty;

                    const alreadyInvoiced = Number(invoicedQtyByOrderItemId.get(String(item.id)) || 0);
                    const available = Math.max(0, allocQty - alreadyInvoiced);
                    availabilityByOrderItemId.set(String(item.id), available);
                }
            });
        }

        const invoiceNumber = generateInvoiceNumber(String(orders[0]?.id || orderItems[0]?.order_id || Date.now()));
        const itemsPayload: any[] = [];
        let itemsSubtotal = 0;
        let discountTotal = 0;
        let shippingFeeTotal = 0;

        const orderSelectedSubtotalById = new Map<string, number>();
        let validationError: string | null = null;
        requestedItems.forEach((reqItem: any) => {
            const orderItem = orderItemById.get(reqItem.order_item_id);
            if (!orderItem) return;
            const available = Number(availabilityByOrderItemId.get(reqItem.order_item_id) || 0);
            if (reqItem.qty > available) {
                validationError = `Qty invoice melebihi alokasi untuk item ${reqItem.order_item_id}.`;
                return;
            }

            const price = Number(orderItem.price_at_purchase || 0);
            const cost = Number(orderItem.cost_at_purchase || 0);
            const lineTotal = Math.round(price * reqItem.qty * 100) / 100;
            itemsSubtotal += lineTotal;
            itemsPayload.push({
                order_item_id: orderItem.id,
                qty: reqItem.qty,
                unit_price: price,
                unit_cost: cost,
                line_total: lineTotal
            });

            const orderId = String(orderItem.order_id || '');
            const prev = Number(orderSelectedSubtotalById.get(orderId) || 0);
            orderSelectedSubtotalById.set(orderId, prev + lineTotal);
        });

        if (validationError) {
            await t.rollback();
            return res.status(400).json({ message: validationError });
        }

        if (itemsPayload.length === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada item teralokasi untuk diterbitkan invoice.' });
        }

        for (const order of orders as any[]) {
            const orderId = String(order.id || '');
            const selectedSubtotal = Number(orderSelectedSubtotalById.get(orderId) || 0);
            if (selectedSubtotal <= 0) continue;
            const orderSubtotalFull = Number(orderFullSubtotalById.get(orderId) || 0);
            const ratio = orderSubtotalFull > 0 ? (selectedSubtotal / orderSubtotalFull) : 0;
            const orderDiscount = Number(order.discount_amount || 0) * ratio;
            const orderShipping = Number(order.shipping_fee || 0) * ratio;
            discountTotal += Math.round(orderDiscount * 100) / 100;
            shippingFeeTotal += Math.round(orderShipping * 100) / 100;
        }

        discountTotal = Math.min(discountTotal, itemsSubtotal);
        const subtotalBase = Math.max(0, Math.round((itemsSubtotal - discountTotal + shippingFeeTotal) * 100) / 100);
        const taxConfig = await TaxConfigService.getConfig();
        const computedTax = computeInvoiceTax(subtotalBase, taxConfig);

        const paymentStatus = paymentMethod === 'cod' || paymentMethod === 'cash_store'
            ? 'cod_pending'
            : 'unpaid';

        const invoice = await Invoice.create({
            order_id: String(orders[0]?.id || null),
            customer_id: customerId || null,
            invoice_number: invoiceNumber,
            payment_method: paymentMethod as any,
            payment_status: paymentStatus,
            amount_paid: 0,
            change_amount: 0,
            subtotal: subtotalBase,
            discount_amount: discountTotal,
            shipping_fee_total: shippingFeeTotal,
            tax_percent: computedTax.tax_percent,
            tax_amount: computedTax.tax_amount,
            total: computedTax.total,
            tax_mode_snapshot: computedTax.tax_mode_snapshot,
            pph_final_amount: computedTax.pph_final_amount
        }, { transaction: t });

        await InvoiceItem.bulkCreate(
            itemsPayload.map((payload) => ({
                ...payload,
                invoice_id: invoice.id
            })),
            { transaction: t }
        );

        const nextStatus = 'ready_to_ship';
        const expiryDate = null;

        const statusProgressRank: Record<string, number> = {
            pending: 1,
            allocated: 1,
            partially_fulfilled: 1,
            debt_pending: 1,
            hold: 1,
            waiting_invoice: 2,
            ready_to_ship: 4,
            shipped: 5,
            delivered: 6,
            completed: 7,
            canceled: 7,
            expired: 7,
        };

        const ordersWithLines = orders.filter((order: any) => Number(orderSelectedSubtotalById.get(String(order.id)) || 0) > 0);
        const prevStatusByOrderId: Record<string, string> = {};
        for (const order of ordersWithLines as any[]) {
            const orderId = String(order.id);
            const currentStatus = String(order.status || '');
            prevStatusByOrderId[orderId] = currentStatus;
            const currentRank = Number(statusProgressRank[currentStatus] || 0);
            const targetRank = Number(statusProgressRank[nextStatus] || 0);
            if (currentRank >= targetRank) continue;
            await order.update(
                { status: nextStatus, expiry_date: expiryDate },
                { transaction: t }
            );
        }

        await t.commit();

        for (const order of ordersWithLines as any[]) {
            const orderId = String(order.id);
            const prevStatus = prevStatusByOrderId[orderId] || '';
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(paymentMethod || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: nextStatus === 'ready_to_ship'
                        ? ['admin_gudang', 'customer']
                        : ['customer'],
                });
            }
        }

        return res.json({
            message: 'Invoice diterbitkan. Order siap diproses gudang.',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            next_status: nextStatus
        });
    } catch (error: any) {
        await t.rollback();
        const message = typeof error?.message === 'string' ? error.message : 'Gagal menerbitkan invoice';
        return res.status(500).json({ message, error });
    }
};

export const verifyPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Order ID
        const { action } = req.body; // 'approve' | 'reject'
        const verifierId = req.user!.id;
        const verifierRole = req.user!.role;

        if (!['admin_finance', 'super_admin'].includes(verifierRole)) {
            await t.rollback();
            return res.status(403).json({ message: 'Hanya admin finance atau super admin yang boleh verifikasi pembayaran' });
        }

        if (action !== 'approve' && action !== 'reject') {
            await t.rollback();
            return res.status(400).json({ message: 'Invalid action' });
        }

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE })
            || await findLatestInvoiceByOrderId(String(id), { transaction: t });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        const orders = uniqueOrderIds.length > 0
            ? await Order.findAll({ where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t, lock: t.LOCK.UPDATE })
            : [];
        if (orders.length === 0) {
            await t.rollback();
            return res.status(404).json({ message: 'Order tidak ditemukan untuk invoice ini' });
        }
        const previousStatusByOrderId: Record<string, string> = {};
        const nextStatusByOrderId: Record<string, string> = {};
        orders.forEach((order: any) => {
            const orderId = String(order.id || '');
            if (!orderId) return;
            const status = String(order.status || '');
            previousStatusByOrderId[orderId] = status;
            nextStatusByOrderId[orderId] = status;
        });
        if (action === 'approve') {
            const isNoProofMethod = ['cod', 'cash_store'].includes(invoice.payment_method);

            if (isNoProofMethod) {
                await t.rollback();
                return res.status(409).json({ message: 'Invoice COD/Cash Store hanya boleh menjadi paid melalui proses settlement.' });
            }

            if (!isNoProofMethod && !invoice.payment_proof_url) {
                await t.rollback();
                return res.status(400).json({ message: 'Bukti transfer belum tersedia untuk diverifikasi' });
            }

            if (invoice.payment_status === 'paid') {
                await t.rollback();
                return res.status(409).json({ message: 'Pembayaran sudah pernah di-approve' });
            }

            await invoice.update({
                payment_status: 'paid',
                verified_by: verifierId,
                verified_at: new Date(),
                amount_paid: Number(invoice.total || 0)
            }, { transaction: t });

            const totalAmount = Number(invoice.total || 0);
            const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
            const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
            const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });

            if (paymentAcc && arAcc && totalAmount > 0) {
                await JournalService.createEntry({
                    description: `Verifikasi Pembayaran Invoice #${invoice.invoice_number}`,
                    reference_type: 'payment_verify',
                    reference_id: invoice.id.toString(),
                    created_by: verifierId,
                    idempotency_key: `payment_verify_${invoice.id}`,
                    lines: [
                        { account_id: paymentAcc.id, debit: totalAmount, credit: 0 },
                        { account_id: arAcc.id, debit: 0, credit: totalAmount }
                    ]
                }, t);
            }

            const toCompletedIds: string[] = [];
            const toReadyToShipIds: string[] = [];
            orders.forEach((order: any) => {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) return;
                if (['completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    return;
                }
                if (currentStatus === 'delivered') {
                    toCompletedIds.push(orderId);
                    nextStatusByOrderId[orderId] = 'completed';
                    return;
                }
                if (currentStatus === 'shipped') {
                    nextStatusByOrderId[orderId] = 'shipped';
                    return;
                }
                toReadyToShipIds.push(orderId);
                nextStatusByOrderId[orderId] = 'ready_to_ship';
            });
            if (toReadyToShipIds.length > 0) {
                await Order.update(
                    { status: 'ready_to_ship', expiry_date: null },
                    { where: { id: { [Op.in]: toReadyToShipIds } }, transaction: t }
                );
            }
            if (toCompletedIds.length > 0) {
                await Order.update(
                    { status: 'completed' },
                    { where: { id: { [Op.in]: toCompletedIds } }, transaction: t }
                );
            }

        } else {
            // Payment rejected but order should still proceed to warehouse (payment handled by driver).
            await invoice.update({
                payment_status: 'unpaid',
                payment_proof_url: null,
                verified_by: null,
                verified_at: null
            }, { transaction: t });
            const toReadyToShipIds: string[] = [];
            orders.forEach((order: any) => {
                const orderId = String(order.id || '');
                const currentStatus = String(order.status || '').toLowerCase();
                if (!orderId) return;
                if (['delivered', 'shipped', 'completed', 'canceled', 'expired'].includes(currentStatus)) {
                    nextStatusByOrderId[orderId] = currentStatus;
                    return;
                }
                toReadyToShipIds.push(orderId);
                nextStatusByOrderId[orderId] = 'ready_to_ship';
            });
            if (toReadyToShipIds.length > 0) {
                await Order.update({
                    status: 'ready_to_ship',
                    expiry_date: null
                }, { where: { id: { [Op.in]: toReadyToShipIds } }, transaction: t });
            }
        }

        await t.commit();
        orders.forEach((order: any) => {
            const orderId = String(order.id || '');
            const prevStatus = String(previousStatusByOrderId[orderId] || order.status || '');
            const nextStatus = String(nextStatusByOrderId[orderId] || prevStatus);
            if (prevStatus !== nextStatus) {
                emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: prevStatus,
                    to_status: nextStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: verifierRole,
                    target_roles: action === 'approve'
                        ? (nextStatus === 'completed' ? ['admin_finance', 'customer'] : ['admin_gudang', 'customer'])
                        : ['customer'],
                });
            }
        });
        emitAdminRefreshBadges();

        res.json({ message: `Payment ${action}d` });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error verifying payment', error });
    }
};

export const voidPayment = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params; // Invoice ID or Order ID? Let's use Invoice ID for precision
        const userId = req.user!.id;

        const invoice = await Invoice.findByPk(String(id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        if (invoice.payment_status !== 'paid') {
            await t.rollback();
            return res.status(400).json({ message: 'Invoice belum dibayar/status bukan paid.' });
        }

        // 1. Find the Journal related to this payment
        // We look for journal with reference_type='order' and reference_id=order_id created closely?
        // Or we just create a reversal based on invoice amount.
        // Better: Re-calculate what the journal WAS (Sales + COGS) and reverse it.
        // Since we don't store journal_id on invoice, we construct the reversal.

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction: t });
        if (invoice.order_id) {
            relatedOrderIds.push(String(invoice.order_id));
        }
        const uniqueOrderIds = Array.from(new Set(relatedOrderIds.filter(Boolean)));
        const orders = uniqueOrderIds.length > 0
            ? await Order.findAll({ where: { id: { [Op.in]: uniqueOrderIds } }, transaction: t, lock: t.LOCK.UPDATE })
            : [];
        if (orders.length === 0) {
            await t.rollback();
            return res.status(404).json({ message: 'Associated orders not found' });
        }

        // REVERSE SALES JOURNAL
        const paymentAccCode = invoice.payment_method === 'transfer_manual' ? '1102' : '1101';
        const paymentAcc = await Account.findOne({ where: { code: paymentAccCode }, transaction: t });
        const revenueAcc = await Account.findOne({ where: { code: '4100' }, transaction: t });

        if (paymentAcc && revenueAcc) {
            await JournalService.createEntry({
                description: `[VOID/REVERSAL] Penjualan Invoice #${invoice.invoice_number}`,
                reference_type: 'order_reversal',
                reference_id: invoice.id.toString(),
                created_by: userId,
                lines: [
                    { account_id: paymentAcc.id, debit: 0, credit: Number(invoice.amount_paid) }, // Credit Cash
                    { account_id: revenueAcc.id, debit: Number(invoice.amount_paid), credit: 0 }  // Debit Revenue
                ]
            }, t);
        }

        // REVERSE COGS JOURNAL
        // Recalculate COGS from invoice items to support multi-order invoices.
        const invoiceItems = await InvoiceItem.findAll({
            where: { invoice_id: invoice.id },
            attributes: ['qty', 'unit_cost'],
            transaction: t
        });
        let totalCost = 0;
        invoiceItems.forEach((item: any) => {
            totalCost += Number(item.unit_cost || 0) * Number(item.qty || 0);
        });

        if (totalCost > 0) {
            const hppAcc = await Account.findOne({ where: { code: '5100' }, transaction: t });
            const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });

            if (hppAcc && inventoryAcc) {
                await JournalService.createEntry({
                    description: `[VOID/REVERSAL] HPP Invoice #${invoice.invoice_number}`,
                    reference_type: 'order_reversal',
                    reference_id: invoice.id.toString(),
                    created_by: userId,
                    lines: [
                        { account_id: hppAcc.id, debit: 0, credit: totalCost }, // Credit HPP (Reduce Expense)
                        { account_id: inventoryAcc.id, debit: totalCost, credit: 0 } // Debit Inventory (Increase Asset)
                    ]
                }, t);
            }
        }

        // 2. Reset Invoice
        await invoice.update({
            payment_status: 'unpaid',
            amount_paid: 0,
            verified_at: null,
            verified_by: null
        }, { transaction: t });

        // 3. Reset Order Status
        const previousOrderStatusById: Record<string, string> = {};
        orders.forEach((order) => {
            previousOrderStatusById[String(order.id)] = String(order.status || '');
        });
        const nextOrderStatus = 'ready_to_ship';
        await Order.update({
            status: 'ready_to_ship',
            expiry_date: null
        }, {
            where: {
                id: { [Op.in]: uniqueOrderIds },
                status: { [Op.ne]: 'canceled' }
            },
            transaction: t
        });

        await t.commit();
        orders.forEach((order) => {
            const previousStatus = previousOrderStatusById[String(order.id)] || '';
            if (previousStatus !== nextOrderStatus && order.status !== 'canceled') {
                emitOrderStatusChanged({
                    order_id: String(order.id),
                    from_status: previousStatus,
                    to_status: nextOrderStatus,
                    source: String(order.source || ''),
                    payment_method: String(invoice.payment_method || ''),
                    courier_id: String(order.courier_id || ''),
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: ['admin_finance', 'customer'],
                });
            }
        });
        emitAdminRefreshBadges();

        res.json({ message: 'Pembayaran berhasil di-void (Reversed)' });

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error voiding payment', error });
    }
};

// --- Expenses ---
export const getExpenses = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, startDate, endDate, category } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        if (startDate && endDate) {
            whereClause.date = {
                [Op.between]: [new Date(startDate as string), new Date(endDate as string)]
            };
        }
        if (typeof category === 'string' && category.trim()) {
            whereClause.category = category.trim();
        }

        const expenses = await Expense.findAndCountAll({
            where: whereClause,
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC']]
        });

        const rows = expenses.rows.map((row) => {
            const plain = row.get({ plain: true }) as any;
            const parsed = parseExpenseNote(plain.note);
            return {
                ...plain,
                note: parsed.text,
                details: parsed.details,
            };
        });

        res.json({
            total: expenses.count,
            totalPages: Math.ceil(expenses.count / Number(limit)),
            currentPage: Number(page),
            expenses: rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching expenses', error });
    }
};

export const createExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { category, amount, date, note, details, payment_method } = req.body;
        const userId = req.user!.id;

        const safeCategory = toSafeText(category);
        const numericAmount = Number(amount);
        if (!safeCategory) {
            await t.rollback();
            return res.status(400).json({ message: 'Kategori wajib diisi' });
        }
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Amount harus lebih besar dari 0' });
        }

        if (!req.file) {
            await t.rollback();
            return res.status(400).json({ message: 'Attachment/Bukti pengeluaran wajib diupload' });
        }

        let parsedDetails = details;
        if (typeof details === 'string') {
            try {
                parsedDetails = JSON.parse(details);
            } catch (e) {
                // Ignore, use as is or empty
            }
        }

        const expense = await Expense.create({
            category: safeCategory,
            amount: numericAmount,
            date: date || new Date(),
            note: buildExpenseNote(note, parsedDetails),
            status: 'requested',
            attachment_url: req.file.path,
            created_by: userId
        }, { transaction: t });

        // No journal entry at creation - moved to payment

        await t.commit();
        res.status(201).json(expense);

    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error creating expense', error });
    }
};

export const approveExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            return res.status(404).json({ message: 'Expense not found' });
        }

        if (expense.status !== 'requested') {
            await t.rollback();
            return res.status(400).json({ message: `Expense status is ${expense.status}, cannot approve` });
        }

        await expense.update({
            status: 'approved',
            approved_by: userId,
            approved_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Expense approved', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error approving expense', error });
    }
};

export const payExpense = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const { account_id } = req.body;
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            return res.status(404).json({ message: 'Expense not found' });
        }

        if (expense.status !== 'approved') {
            await t.rollback();
            return res.status(400).json({ message: `Expense must be approved before payment. Current status: ${expense.status}` });
        }

        if (!account_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Account ID (source of funds) is required' });
        }

        const paymentAcc = await Account.findByPk(account_id, { transaction: t });
        if (!paymentAcc) {
            await t.rollback();
            return res.status(404).json({ message: 'Payment account not found' });
        }

        await expense.update({
            status: 'paid',
            account_id: account_id,
            paid_at: new Date()
        }, { transaction: t });

        // --- Create Journal Entry (Expense vs Cash/Bank) ---
        // Map category to COA code
        let expenseAccountCode = '5300'; // Default: Operasional
        const catLower = expense.category.toLowerCase();
        // Simple mapping based on keywords, ideally stored in config or ExpenseLabel
        if (catLower.includes('gaji')) expenseAccountCode = '5200';
        else if (catLower.includes('listrik') || catLower.includes('utility')) expenseAccountCode = '5300'; // Or specific code
        else if (catLower.includes('transport') || catLower.includes('ongkir')) expenseAccountCode = '5500';
        else if (catLower.includes('hpp') || catLower.includes('modal')) expenseAccountCode = '5100';
        else if (catLower.includes('refund')) expenseAccountCode = '4100-REFUND'; // Example, handle carefully

        let expenseAcc = await Account.findOne({ where: { code: expenseAccountCode }, transaction: t });

        // Fallback if specific account not found, use General Expense (5900 if created?) or just keep 5300
        if (!expenseAcc) {
            expenseAcc = await Account.findOne({ where: { code: '5300' }, transaction: t });
        }

        if (expenseAcc) {
            await JournalService.createEntry({
                description: `Expense Payment: ${expense.category} - ${expense.note || ''}`,
                reference_type: 'expense',
                reference_id: expense.id.toString(),
                created_by: userId,
                date: new Date(),
                lines: [
                    { account_id: expenseAcc.id, debit: Number(expense.amount), credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: Number(expense.amount) }
                ]
            }, t);
        }

        await t.commit();
        res.json({ message: 'Expense paid', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error paying expense', error });
    }
};


export const getExpenseLabels = async (_req: Request, res: Response) => {
    try {
        await ensureDefaultExpenseLabels();
        const labels = await ExpenseLabel.findAll({
            order: [['name', 'ASC']]
        });
        res.json({ labels });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching expense labels', error });
    }
};

export const createExpenseLabel = async (req: Request, res: Response) => {
    try {
        const name = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);

        if (!name) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({ attributes: ['name'] });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === name.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Label sudah ada' });
        }

        const label = await ExpenseLabel.create({
            name,
            description: description || null
        });
        res.status(201).json({ message: 'Label created', label });
    } catch (error) {
        res.status(500).json({ message: 'Error creating expense label', error });
    }
};

export const updateExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        const nextName = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);
        if (!nextName) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({
            where: { id: { [Op.ne]: id } },
            attributes: ['name']
        });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === nextName.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Nama label sudah digunakan' });
        }

        await label.update({
            name: nextName,
            description: description || null
        });
        res.json({ message: 'Label updated', label });
    } catch (error) {
        res.status(500).json({ message: 'Error updating expense label', error });
    }
};

export const deleteExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        await label.destroy();
        res.json({ message: 'Label deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting expense label', error });
    }
};

// --- Tax Settings ---
export const getTaxSettings = async (_req: Request, res: Response) => {
    try {
        const config = await TaxConfigService.getConfig();
        return res.json(config);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching tax settings', error });
    }
};

export const updateTaxSettings = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const current = await TaxConfigService.getConfig();
        const modeRaw = typeof req.body?.company_tax_mode === 'string'
            ? req.body.company_tax_mode.trim().toLowerCase()
            : '';
        const nextMode = modeRaw === 'pkp' || modeRaw === 'non_pkp'
            ? (modeRaw as 'pkp' | 'non_pkp')
            : null;

        const vatPercent = normalizeTaxNumber(req.body?.vat_percent);
        const pphPercent = normalizeTaxNumber(req.body?.pph_final_percent);

        if (!nextMode && vatPercent === null && pphPercent === null) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada perubahan pada pengaturan pajak.' });
        }

        if (modeRaw && !nextMode) {
            await t.rollback();
            return res.status(400).json({ message: 'company_tax_mode harus pkp atau non_pkp.' });
        }

        const nextConfig = {
            company_tax_mode: nextMode || current.company_tax_mode,
            vat_percent: vatPercent !== null ? vatPercent : current.vat_percent,
            pph_final_percent: pphPercent !== null ? pphPercent : current.pph_final_percent
        };

        await Setting.upsert({
            key: 'company_tax_config',
            value: nextConfig,
            description: 'Tax mode and rates for company (Indonesia)'
        }, { transaction: t });

        await t.commit();
        return res.json(nextConfig);
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Error updating tax settings', error });
    }
};

// --- Reports ---
export const getAccountsReceivable = async (req: Request, res: Response) => {
    try {
        // 1. Get AR from Invoices (payment_status != 'paid')
        const ar = await Invoice.findAll({
            where: {
                payment_status: { [Op.ne]: 'paid' } // unpaid, cod_pending
            },
            include: buildAccountsReceivableInclude(),
            order: [['createdAt', 'ASC']] // Oldest first
        });

        const context = await buildAccountsReceivableContext(ar);
        const invoiceRows = mapAccountsReceivableRows(ar, context);

        // 2. Get Driver Debts (User.debt > 0)
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
        });

        const driverRows = debtors.map(driver => {
            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            return {
                id: `debt-${driver.id}`,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
        });

        res.json([...invoiceRows, ...driverRows]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching AR', error });
    }
};

export const getAccountsReceivableDetail = async (req: Request, res: Response) => {
    try {
        const invoiceId = String(req.params.id || '').trim();
        if (!invoiceId) {
            return res.status(400).json({ message: 'invoice id wajib diisi' });
        }

        // Handle pseudo-ID for driver debt
        if (invoiceId.startsWith('debt-')) {
            const driverId = invoiceId.replace('debt-', '');
            const driver = await User.findOne({
                where: {
                    id: driverId,
                    role: 'driver',
                    debt: { [Op.gt]: 0 }
                },
                attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
            });

            if (!driver) {
                return res.status(404).json({ message: 'Data piutang driver tidak ditemukan' });
            }

            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            const row = {
                id: invoiceId,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
            return res.json(row);
        }

        const invoice = await Invoice.findOne({
            where: {
                id: invoiceId,
                payment_status: { [Op.ne]: 'paid' }
            },
            include: buildAccountsReceivableInclude()
        });

        if (!invoice) {
            return res.status(404).json({ message: 'Data piutang tidak ditemukan' });
        }

        const context = await buildAccountsReceivableContext([invoice]);
        const [row] = mapAccountsReceivableRows([invoice], context);
        if (!row) {
            return res.status(404).json({ message: 'Data piutang tidak ditemukan' });
        }
        return res.json(row);
    } catch (error) {
        return res.status(500).json({ message: 'Error fetching AR detail', error });
    }
};

export const getProfitAndLoss = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter[Op.between] = [new Date(startDate as string), new Date(endDate as string)];
        }

        // 1. Revenue (Completed Sales)
        // Orders where status = completed? Or just Paid invoices?
        // Revenue is recognized when delivered or when paid?
        // Simple PnL: Sales (Paid Invoices) - COGS - Expenses

        const sales = await Invoice.sum('amount_paid', {
            where: {
                payment_status: 'paid',
                verified_at: dateFilter // Using verified_at instead of updatedAt
            }
        }) || 0;

        // 2. COGS (Cost of Goods Sold)
        // Aggregate from invoice items to support multi-order invoices.
        const paidInvoices = await Invoice.findAll({
            where: { payment_status: 'paid', verified_at: dateFilter },
            attributes: ['id']
        });

        const paidInvoiceIds = paidInvoices.map((invoice) => String(invoice.id));
        let cogs = 0;
        if (paidInvoiceIds.length > 0) {
            const invoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: paidInvoiceIds } },
                attributes: ['qty', 'unit_cost']
            });
            invoiceItems.forEach((item: any) => {
                cogs += Number(item.unit_cost || 0) * Number(item.qty || 0);
            });
        }

        // 3. Expenses
        const opex = await Expense.sum('amount', {
            where: {
                date: dateFilter
            }
        }) || 0;

        const grossProfit = Number(sales) - cogs;
        const netProfit = grossProfit - Number(opex);

        res.json({
            period: { startDate, endDate },
            revenue: Number(sales),
            cogs,
            gross_profit: grossProfit,
            expenses: Number(opex),
            net_profit: netProfit
        });

    } catch (error) {
        res.status(500).json({ message: 'Error calculating P&L', error });
    }
};

// --- Driver COD Deposit ---

export const getDriverCodList = async (req: Request, res: Response) => {
    try {
        // 1. Get drivers with debt > 0
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt']
        });

        // 2. Get pending COD invoices linked to orders
        const invoiceItems = await InvoiceItem.findAll({
            include: [{
                model: Invoice,
                where: { payment_status: 'cod_pending' },
                required: true
            }, {
                model: OrderItem,
                attributes: ['order_id'],
                required: true
            }]
        });

        const orderInvoiceMap = new Map<string, any>();
        invoiceItems.forEach((item: any) => {
            const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
            const invoice = item.Invoice;
            if (!orderId || !invoice) return;
            const existing = orderInvoiceMap.get(orderId);
            if (!existing) {
                orderInvoiceMap.set(orderId, invoice);
                return;
            }
            const existingTime = new Date(existing.createdAt || 0).getTime();
            const nextTime = new Date(invoice.createdAt || 0).getTime();
            if (nextTime > existingTime) {
                orderInvoiceMap.set(orderId, invoice);
            }
        });

        const orderIds = Array.from(orderInvoiceMap.keys());
        const orders = orderIds.length > 0
            ? await Order.findAll({
                where: { id: { [Op.in]: orderIds } },
                include: [{
                    model: User,
                    as: 'Courier',
                    attributes: ['id', 'name', 'whatsapp_number', 'debt']
                }, {
                    model: User,
                    as: 'Customer',
                    attributes: ['id', 'name']
                }]
            })
            : [];

        const grouped: Record<string, any> = {};
        const driverInvoiceTotals = new Map<string, Map<string, number>>();

        // Initialize from debtors
        debtors.forEach(driver => {
            grouped[driver.id] = {
                driver: {
                    id: driver.id,
                    name: driver.name,
                    whatsapp_number: driver.whatsapp_number,
                    debt: Number(driver.debt || 0)
                },
                orders: [],
                total_pending: 0
            };
            driverInvoiceTotals.set(String(driver.id), new Map<string, number>());
        });

        // Merge/Add from invoices
        orders.forEach((order) => {
            const courier = (order as any).Courier;
            if (!courier) return;
            const inv = orderInvoiceMap.get(String(order.id));
            if (!inv) return;

            if (!grouped[courier.id]) {
                grouped[courier.id] = {
                    driver: {
                        id: courier.id,
                        name: courier.name,
                        whatsapp_number: courier.whatsapp_number,
                        debt: Number(courier.debt || 0)
                    },
                    orders: [],
                    total_pending: 0
                };
                driverInvoiceTotals.set(String(courier.id), new Map<string, number>());
            }

            const invoiceId = String((inv as any).id || '');
            const invoiceNumber = String((inv as any).invoice_number || '');
            const invoiceTotalRaw = Number((inv as any).total);
            const invoiceTotal = Number.isFinite(invoiceTotalRaw) ? invoiceTotalRaw : 0;
            grouped[courier.id].orders.push({
                id: order.id,
                order_number: order.id,
                customer_name: (order as any).Customer?.name || 'Customer',
                total_amount: invoiceTotal,
                invoice_id: invoiceId || null,
                invoice_number: invoiceNumber || null,
                invoice_total: invoiceTotal,
                created_at: order.createdAt
            });

            const driverInvoiceMap = driverInvoiceTotals.get(String(courier.id)) || new Map<string, number>();
            const invoiceKey = invoiceId || `order-${String(order.id)}`;
            if (!driverInvoiceMap.has(invoiceKey)) {
                driverInvoiceMap.set(invoiceKey, invoiceTotal);
            }
            driverInvoiceTotals.set(String(courier.id), driverInvoiceMap);
        });

        Object.keys(grouped).forEach((driverId) => {
            const driverInvoiceMap = driverInvoiceTotals.get(String(driverId));
            const totalPending = driverInvoiceMap
                ? Array.from(driverInvoiceMap.values()).reduce((sum, value) => sum + Number(value || 0), 0)
                : 0;
            grouped[driverId].total_pending = totalPending;
        });

        res.json(Object.values(grouped));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching driver COD list', error });
    }
};

export const verifyDriverCod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { driver_id, order_ids = [], amount_received } = req.body;
        const selectedOrderIds = Array.isArray(order_ids)
            ? order_ids.map((value: unknown) => String(value)).filter(Boolean)
            : [];
        const verifierId = req.user!.id;

        if (!driver_id) {
            await t.rollback();
            return res.status(400).json({ message: 'Driver ID required' });
        }

        const received = Number(amount_received);
        if (isNaN(received) || received < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah uang tidak valid' });
        }

        if (selectedOrderIds.length === 0 && received === 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Tidak ada order dipilih dan tidak ada pembayaran.' });
        }

        let invoices: any[] = [];
        let totalExpected = 0;
        const previousOrderStatusById: Record<string, string> = {};
        const orderToInvoiceMap = new Map<string, any>();
        const orderById = new Map<string, any>();
        let affectedOrderIds: string[] = [];
        let settlementId: string | null = null;
        let settledAtIso: string | null = null;
        let settledInvoiceIds: string[] = [];
        let completedOrderIds: string[] = [];

        if (selectedOrderIds.length > 0) {
            const selectedOrders = await Order.findAll({
                where: {
                    id: { [Op.in]: selectedOrderIds },
                    courier_id: driver_id
                },
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            if (selectedOrders.length !== selectedOrderIds.length) {
                await t.rollback();
                return res.status(409).json({ message: 'Beberapa pesanan tidak ditemukan atau bukan milik driver ini.' });
            }

            const orderItems = await OrderItem.findAll({
                where: { order_id: { [Op.in]: selectedOrderIds } },
                attributes: ['id', 'order_id'],
                transaction: t
            });
            const orderItemIds = orderItems.map((item: any) => String(item.id));
            if (orderItemIds.length === 0) {
                await t.rollback();
                return res.status(409).json({ message: 'Order tidak memiliki item untuk ditagihkan.' });
            }

            const invoiceItems = await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: orderItemIds } },
                include: [{
                    model: Invoice,
                    where: { payment_status: 'cod_pending' },
                    required: true
                }, {
                    model: OrderItem,
                    attributes: ['order_id'],
                    required: true
                }],
                transaction: t,
                lock: t.LOCK.UPDATE
            });

            const invoiceMap = new Map<string, any>();
            invoiceItems.forEach((item: any) => {
                const invoice = item.Invoice;
                if (!invoice) return;
                invoiceMap.set(String(invoice.id), invoice);
            });

            if (invoiceMap.size === 0) {
                await t.rollback();
                return res.status(409).json({ message: 'Invoice COD pending tidak ditemukan untuk order yang dipilih.' });
            }

            const invoiceIds = Array.from(invoiceMap.keys());
            const allInvoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: invoiceIds } },
                include: [{
                    model: OrderItem,
                    attributes: ['order_id'],
                    required: true
                }],
                transaction: t
            });

            const invoiceOrderIdsMap = new Map<string, Set<string>>();
            allInvoiceItems.forEach((item: any) => {
                const invoiceId = String(item.invoice_id);
                const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
                if (!orderId) return;
                const set = invoiceOrderIdsMap.get(invoiceId) || new Set<string>();
                set.add(orderId);
                invoiceOrderIdsMap.set(invoiceId, set);
            });

            const allOrderIds = Array.from(new Set(
                Array.from(invoiceOrderIdsMap.values()).flatMap((set) => Array.from(set))
            ));
            const allOrders = await Order.findAll({
                where: { id: { [Op.in]: allOrderIds } },
                transaction: t,
                lock: t.LOCK.UPDATE
            });
            allOrders.forEach((order) => {
                orderById.set(String(order.id), order);
            });

            for (const [invoiceId, orderSet] of invoiceOrderIdsMap.entries()) {
                for (const orderId of orderSet) {
                    const order = orderById.get(orderId);
                    if (!order || String(order.courier_id || '') !== String(driver_id)) {
                        await t.rollback();
                        return res.status(409).json({ message: 'Invoice COD gabungan hanya bisa diselesaikan oleh driver yang sama.' });
                    }
                    if (!selectedOrderIds.includes(orderId)) {
                        await t.rollback();
                        return res.status(409).json({ message: 'Pilih semua order dalam invoice COD gabungan.' });
                    }
                }
            }

            invoices = Array.from(invoiceMap.values());
            totalExpected = invoices.reduce((sum, invoice: any) => {
                const invoiceTotal = Number(invoice?.total);
                return sum + (Number.isFinite(invoiceTotal) ? invoiceTotal : 0);
            }, 0);

            affectedOrderIds = allOrderIds;
            allOrders.forEach((order: any) => {
                previousOrderStatusById[String(order.id)] = String(order.status || '');
            });

            invoiceOrderIdsMap.forEach((orderSet, invId) => {
                const inv = invoiceMap.get(invId);
                if (!inv) return;
                orderSet.forEach((orderId) => {
                    orderToInvoiceMap.set(orderId, inv);
                });
            });
        }

        const diff = received - totalExpected;
        // diff < 0 : Shortage -> Driver Debt increases
        // diff > 0 : Surplus -> Driver Debt decreases (pay off)

        const driver = await User.findByPk(driver_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!driver) {
            await t.rollback();
            return res.status(404).json({ message: 'Driver tidak ditemukan' });
        }

        const previousDebt = Number(driver.debt || 0);
        const newDebt = Math.max(0, previousDebt + totalExpected - received);

        await driver.update({ debt: newDebt }, { transaction: t });

        if (invoices.length > 0) {
            // New logic: Find pending CodCollections for these invoices
            const invoiceIds = invoices.map(i => i.id);
            const collections = await CodCollection.findAll({
                where: {
                    invoice_id: { [Op.in]: invoiceIds },
                    driver_id: driver_id,
                    status: 'collected'
                },
                transaction: t
            });

            const collectionSum = collections.reduce((acc, c) => acc + Number(c.amount), 0);

            // Create Settlement
            const settlement = await CodSettlement.create({
                driver_id: driver_id,
                total_amount: received,
                received_by: verifierId,
                settled_at: new Date()
            }, { transaction: t });
            settlementId = String(settlement.id);
            settledAtIso = settlement.settled_at ? new Date(settlement.settled_at).toISOString() : new Date().toISOString();
            settledInvoiceIds = invoiceIds.map((value) => String(value));

            // Mark collections as settled
            if (collections.length > 0) {
                await CodCollection.update({
                    status: 'settled',
                    settlement_id: settlement.id
                }, {
                    where: { id: { [Op.in]: collections.map(c => c.id) } },
                    transaction: t
                });
            }

            const fullySettled = received >= totalExpected;
            if (fullySettled) {
                await Invoice.update({
                    payment_status: 'paid',
                    verified_at: new Date(),
                    verified_by: verifierId
                }, {
                    where: { id: { [Op.in]: invoiceIds } },
                    transaction: t
                });

                await Order.update({
                    status: 'completed'
                }, {
                    where: { id: { [Op.in]: affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds } },
                    transaction: t
                });
                completedOrderIds = [...(affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds)];
            }

            // --- Journal Entry for Settlement (Cash vs Piutang Driver) ---
            if (totalExpected > 0 || received > 0) {
                const cashAcc = await Account.findOne({ where: { code: '1101' }, transaction: t });
                const piutangDriverAcc = await Account.findOne({ where: { code: '1104' }, transaction: t });

                if (cashAcc && piutangDriverAcc) {
                    const journalLines: any[] = [];

                    // a. Cash Received
                    if (received > 0) {
                        journalLines.push({ account_id: cashAcc.id, debit: received, credit: 0 });

                        // b. Reduce Driver Receivable
                        journalLines.push({ account_id: piutangDriverAcc.id, debit: 0, credit: received });
                    }

                    if (journalLines.length >= 2) {
                        await JournalService.createEntry({
                            description: `Setoran COD Settlement #${settlement.id} (Driver: ${driver.name})`,
                            reference_type: 'cod_settlement',
                            reference_id: settlement.id.toString(),
                            created_by: verifierId,
                            lines: journalLines
                        }, t);
                    }
                }
            }
        }

        await t.commit();
        if (completedOrderIds.length > 0) {
            for (const orderId of completedOrderIds) {
                const inv = orderToInvoiceMap.get(orderId);
                const orderData = orderById.get(orderId);
                const previousStatus = previousOrderStatusById[orderId] || String(orderData?.status || '');
                if (previousStatus === 'completed') continue;
                const courierId = String(orderData?.courier_id || '');
                emitOrderStatusChanged({
                    order_id: orderId,
                    from_status: previousStatus || null,
                    to_status: 'completed',
                    source: String(orderData?.source || ''),
                    payment_method: String((inv as any)?.payment_method || ''),
                    courier_id: courierId || null,
                    triggered_by_role: String(req.user?.role || ''),
                    target_roles: ['admin_finance', 'driver', 'customer'],
                    target_user_ids: courierId ? [courierId] : [],
                });
            }
        }

        emitCodSettlementUpdated({
            driver_id: String(driver_id),
            order_ids: affectedOrderIds.length > 0 ? affectedOrderIds : selectedOrderIds,
            invoice_ids: settledInvoiceIds,
            total_expected: totalExpected,
            amount_received: received,
            driver_debt_before: previousDebt,
            driver_debt_after: newDebt,
            settled_at: settledAtIso || new Date().toISOString(),
            triggered_by_role: String(req.user?.role || ''),
            target_roles: ['admin_finance', 'driver'],
            target_user_ids: [String(driver_id)],
        });

        res.json({
            message: 'Setoran COD berhasil dikonfirmasi',
            summary: {
                total_expected: totalExpected,
                received: received,
                shortage: diff < 0 ? Math.abs(diff) : 0,
                surplus: diff > 0 ? diff : 0,
                driver_debt_before: previousDebt,
                driver_debt_after: newDebt
            },
            settlement: settlementId ? 'created' : 'skipped'
        });

    } catch (error) {
        try { await t.rollback(); } catch { }
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error verifying driver COD', error: errMsg });
    }
};

export const createCreditNote = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { invoice_id, reason, mode = 'receivable', amount, tax_amount = 0, lines = [] } = req.body || {};
        const userId = req.user!.id;
        const invoice = await Invoice.findByPk(String(invoice_id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice tidak ditemukan' });
        }

        const creditAmount = Math.max(0, Number(amount || 0));
        if (creditAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Nominal credit note tidak valid' });
        }

        const cn = await CreditNote.create({
            invoice_id: invoice.id,
            credit_note_number: genCreditNoteNumber(),
            amount: creditAmount,
            tax_amount: Math.max(0, Number(tax_amount || 0)),
            reason: typeof reason === 'string' ? reason.trim() : null,
            mode: mode === 'cash_refund' ? 'cash_refund' : 'receivable',
            status: 'draft'
        }, { transaction: t });

        if (Array.isArray(lines) && lines.length > 0) {
            for (const line of lines) {
                const qty = Math.max(1, Number(line?.qty || 1));
                const unitPrice = Math.max(0, Number(line?.unit_price || 0));
                const lineSubtotal = Math.max(0, Number(line?.line_subtotal ?? qty * unitPrice));
                const lineTax = Math.max(0, Number(line?.line_tax || 0));
                const lineTotal = Math.max(0, Number(line?.line_total ?? lineSubtotal + lineTax));
                await CreditNoteLine.create({
                    credit_note_id: cn.id,
                    product_id: line?.product_id || null,
                    description: line?.description || null,
                    qty,
                    unit_price: unitPrice,
                    line_subtotal: lineSubtotal,
                    line_tax: lineTax,
                    line_total: lineTotal
                }, { transaction: t });
            }
        }

        await t.commit();
        return res.status(201).json({ message: 'Credit note draft dibuat', credit_note: cn });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal membuat credit note', error });
    }
};

export const postCreditNote = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = Number(req.params.id);
        const payNow = Boolean(req.body?.pay_now);
        const paymentAccountCode = String(req.body?.payment_account_code || '1101');
        const userId = req.user!.id;

        const cn = await CreditNote.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!cn) {
            await t.rollback();
            return res.status(404).json({ message: 'Credit note tidak ditemukan' });
        }
        if (cn.status !== 'draft') {
            await t.rollback();
            return res.status(409).json({ message: 'Credit note sudah diposting' });
        }

        const invoice = await Invoice.findByPk(String(cn.invoice_id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice terkait tidak ditemukan' });
        }

        const salesReturnAcc = await Account.findOne({ where: { code: '4101' }, transaction: t });
        const ppnOutputAcc = await Account.findOne({ where: { code: '2201' }, transaction: t });
        const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
        const refundPayableAcc = await Account.findOne({ where: { code: '2203' }, transaction: t });
        const paymentAcc = await Account.findOne({ where: { code: paymentAccountCode }, transaction: t });

        const amount = Number(cn.amount || 0);
        const taxAmount = Number(cn.tax_amount || 0);
        const dpp = Math.max(0, amount - taxAmount);

        const creditTargetAcc = (cn.mode === 'cash_refund' && refundPayableAcc)
            ? refundPayableAcc
            : arAcc;
        const lines: any[] = [];
        if (salesReturnAcc && dpp > 0) lines.push({ account_id: salesReturnAcc.id, debit: dpp, credit: 0 });
        if (taxAmount > 0 && ppnOutputAcc) lines.push({ account_id: ppnOutputAcc.id, debit: taxAmount, credit: 0 });
        if (creditTargetAcc) lines.push({ account_id: creditTargetAcc.id, debit: 0, credit: amount });

        if (lines.length >= 2) {
            await JournalService.createEntry({
                description: `Posting Credit Note ${cn.credit_note_number}`,
                reference_type: 'credit_note',
                reference_id: String(cn.id),
                created_by: String(userId),
                idempotency_key: `credit_note_post_${cn.id}`,
                lines
            }, t);
        }

        if (payNow && cn.mode === 'cash_refund' && refundPayableAcc && paymentAcc) {
            await JournalService.createEntry({
                description: `Refund payout Credit Note ${cn.credit_note_number}`,
                reference_type: 'credit_note_refund',
                reference_id: String(cn.id),
                created_by: String(userId),
                idempotency_key: `credit_note_refund_${cn.id}`,
                lines: [
                    { account_id: refundPayableAcc.id, debit: amount, credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: amount }
                ]
            }, t);
            await cn.update({ status: 'refunded', posted_at: new Date(), posted_by: userId }, { transaction: t });
        } else {
            await cn.update({ status: 'posted', posted_at: new Date(), posted_by: userId }, { transaction: t });
        }

        await t.commit();
        return res.json({ message: 'Credit note berhasil diposting', credit_note: cn });
    } catch (error) {
        try { await t.rollback(); } catch { }
        return res.status(500).json({ message: 'Gagal posting credit note', error });
    }
};

// --- Journals ---
export const getJournals = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 50, startDate, endDate } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (startDate && endDate) {
            where.date = { [Op.between]: [startDate, endDate] };
        }

        const journals = await Journal.findAndCountAll({
            where,
            include: [{ model: JournalLine, as: 'Lines', include: [{ model: Account, as: 'Account' }] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC'], ['id', 'DESC']]
        });

        res.json({
            total: journals.count,
            totalPages: Math.ceil(journals.count / Number(limit)),
            currentPage: Number(page),
            journals: journals.rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching journals', error });
    }
};

// --- Accounting Periods & Adjustments ---

export const getAccountingPeriods = async (req: Request, res: Response) => {
    try {
        const periods = await AccountingPeriod.findAll({
            order: [['year', 'DESC'], ['month', 'DESC']]
        });
        res.json(periods);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching periods', error });
    }
};

export const closeAccountingPeriod = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { month, year } = req.body;
        const userId = req.user!.id;

        if (!month || !year) {
            await t.rollback();
            return res.status(400).json({ message: 'Month dan Year wajib diisi' });
        }

        const [period, created] = await AccountingPeriod.findOrCreate({
            where: { month, year },
            defaults: {
                month,
                year,
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            },
            transaction: t
        });

        if (!created && period.is_closed) {
            await t.rollback();
            return res.status(400).json({ message: 'Periode sudah ditutup sebelumnya' });
        }

        if (!created) {
            await period.update({
                is_closed: true,
                closed_at: new Date(),
                closed_by: userId
            }, { transaction: t });
        }

        await t.commit();
        res.json({ message: `Periode ${month}/${year} berhasil ditutup`, period });
    } catch (error) {
        try { await t.rollback(); } catch { }
        res.status(500).json({ message: 'Error closing period', error });
    }
};

export const createAdjustmentJournal = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { date, description, lines } = req.body;
        const userId = req.user!.id;

        if (!lines || !Array.isArray(lines) || lines.length < 2) {
            await t.rollback();
            return res.status(400).json({ message: 'Journal adjustment minimal 2 baris (Debit/Credit)' });
        }

        // Use createAdjustmentEntry which bypasses period lock enforcement 
        // OR enforces strict "Adjustment Only" logic
        const journal = await JournalService.createAdjustmentEntry({
            date: date ? new Date(date) : new Date(),
            description: `[ADJUSTMENT] ${description}`,
            reference_type: 'adjustment', // Custom type
            created_by: userId,
            lines
        }, t);

        await t.commit();
        res.status(201).json({ message: 'Adjustment journal created', journal });
    } catch (error) {
        try { await t.rollback(); } catch { }
        const msg = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ message: 'Error creating adjustment', error: msg });
    }
};
