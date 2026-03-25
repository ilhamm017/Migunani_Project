import { Op, Transaction } from 'sequelize';
import { Invoice, InvoiceItem, OrderItem, Retur } from '../models';

const round2 = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

type PerOrderItemReturnedQty = Record<string, number>;

export type InvoiceNetTotals = {
    invoice_id: string;
    gross_total: number;
    net_total: number;
    return_total: number;
    old_items_subtotal: number;
    new_items_subtotal: number;
    old_discount_amount: number;
    new_discount_amount: number;
    shipping_fee_total: number;
    tax_mode_snapshot: 'pkp' | 'non_pkp';
    tax_percent: number;
    tax_amount: number;
    pph_final_amount: number | null;
    per_order_item_returned_qty: PerOrderItemReturnedQty;
};

const normalizeEffectiveReturQty = (retur: any, overrides?: Record<string, number | null>): number => {
    const returId = String(retur?.id || '').trim();
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, returId)) {
        const forced = overrides[returId];
        return Number.isFinite(Number(forced)) ? Math.max(0, Math.trunc(Number(forced))) : 0;
    }

    const status = String(retur?.status || '').trim().toLowerCase();
    const returType = String(retur?.retur_type || '').trim().toLowerCase();
    const baseQty = Math.max(0, Math.trunc(Number(retur?.qty || 0)));
    // NOTE:
    // - delivery_refusal: effective qty follows warehouse verification (qty_received) once received/completed.
    // - delivery_damage: invoice collectible is reduced immediately based on claimed qty and should not be increased back by warehouse qty_received.
    if ((status === 'received' || status === 'completed') && returType !== 'delivery_damage') {
        const received = Number(retur?.qty_received);
        if (Number.isFinite(received)) {
            return Math.max(0, Math.min(baseQty, Math.trunc(received)));
        }
    }
    return baseQty;
};

export const computeInvoiceNetTotals = async (
    invoiceId: string,
    options?: {
        transaction?: Transaction;
        effective_qty_override_by_retur_id?: Record<string, number | null>;
    }
): Promise<InvoiceNetTotals> => {
    const invoice = await Invoice.findByPk(String(invoiceId), {
        transaction: options?.transaction,
        include: [{
            model: InvoiceItem,
            as: 'Items',
            attributes: ['id', 'qty', 'unit_price', 'line_total', 'order_item_id'],
            include: [{
                model: OrderItem,
                attributes: ['id', 'order_id', 'product_id']
            }]
        }]
    });
    if (!invoice) {
        throw new Error('Invoice tidak ditemukan');
    }

    const plain = invoice.get({ plain: true }) as any;
    const items = Array.isArray(plain.Items) ? plain.Items : [];
    const orderIds: string[] = Array.from(new Set(
        items
            .map((row: any) => String(row?.OrderItem?.order_id || '').trim())
            .filter(Boolean)
    ));

    const returs = orderIds.length > 0
        ? await Retur.findAll({
            where: {
                order_id: { [Op.in]: orderIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: { [Op.ne]: 'rejected' }
            },
            attributes: ['id', 'order_id', 'product_id', 'qty', 'qty_received', 'status', 'retur_type'],
            transaction: options?.transaction
        })
        : [];

    const effectiveReturnByOrderProduct = new Map<string, number>();
    returs.forEach((retur: any) => {
        const orderId = String(retur?.order_id || '').trim();
        const productId = String(retur?.product_id || '').trim();
        if (!orderId || !productId) return;
        const key = `${orderId}:${productId}`;
        const eff = normalizeEffectiveReturQty(retur, options?.effective_qty_override_by_retur_id);
        const prev = Number(effectiveReturnByOrderProduct.get(key) || 0);
        effectiveReturnByOrderProduct.set(key, prev + eff);
    });

    const perOrderItemReturnedQty: PerOrderItemReturnedQty = {};
    const itemsByOrderProduct = new Map<string, any[]>();
    items.forEach((row: any) => {
        const orderId = String(row?.OrderItem?.order_id || '').trim();
        const productId = String(row?.OrderItem?.product_id || '').trim();
        const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
        if (!orderId || !productId || !orderItemId) return;
        const key = `${orderId}:${productId}`;
        const bucket = itemsByOrderProduct.get(key) || [];
        bucket.push(row);
        itemsByOrderProduct.set(key, bucket);
    });

    itemsByOrderProduct.forEach((bucket, key) => {
        let remaining = Math.max(0, Math.trunc(Number(effectiveReturnByOrderProduct.get(key) || 0)));
        if (remaining <= 0) return;

        const sorted = [...bucket].sort((a: any, b: any) => {
            const aId = String(a?.order_item_id || a?.OrderItem?.id || '');
            const bId = String(b?.order_item_id || b?.OrderItem?.id || '');
            const aNum = Number(aId);
            const bNum = Number(bId);
            if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
            return aId.localeCompare(bId);
        });

        for (const row of sorted) {
            if (remaining <= 0) break;
            const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
            if (!orderItemId) continue;
            const lineQty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            if (lineQty <= 0) continue;
            const take = Math.max(0, Math.min(remaining, lineQty));
            remaining -= take;
            perOrderItemReturnedQty[orderItemId] = (perOrderItemReturnedQty[orderItemId] || 0) + take;
        }
    });

    let oldItemsSubtotal = 0;
    let newItemsSubtotal = 0;
    items.forEach((row: any) => {
        const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
        const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
        const unitPrice = Math.max(0, Number(row?.unit_price || 0));
        const returnedQty = Math.max(0, Math.min(qty, Math.trunc(Number(perOrderItemReturnedQty[orderItemId] || 0))));
        const oldLine = round2(unitPrice * qty);
        const newLine = round2(unitPrice * Math.max(0, qty - returnedQty));
        oldItemsSubtotal += oldLine;
        newItemsSubtotal += newLine;
    });
    oldItemsSubtotal = round2(oldItemsSubtotal);
    newItemsSubtotal = round2(newItemsSubtotal);

    const shippingFeeTotal = round2(Number(plain?.shipping_fee_total || 0));
    const isFullReturnAllItems = oldItemsSubtotal > 0.01 && newItemsSubtotal <= 0.01;
    // Policy: if customer returns all items, shipping is waived (hangus for company).
    const effectiveShippingFeeTotal = isFullReturnAllItems ? 0 : shippingFeeTotal;
    const oldDiscount = round2(Number(plain?.discount_amount || 0));
    const ratio = oldItemsSubtotal > 0 ? (newItemsSubtotal / oldItemsSubtotal) : 0;
    const newDiscount = round2(Math.min(newItemsSubtotal, Math.max(0, oldDiscount * ratio)));

    const subtotalBase = round2(Math.max(0, newItemsSubtotal - newDiscount + effectiveShippingFeeTotal));
    const taxMode = plain?.tax_mode_snapshot === 'pkp' ? 'pkp' : 'non_pkp';
    const taxPercent = Number(plain?.tax_percent || 0);
    let taxAmount = 0;
    let pphFinalAmount: number | null = null;
    let netTotal = subtotalBase;
    if (taxMode === 'pkp') {
        taxAmount = round2(subtotalBase * (taxPercent / 100));
        netTotal = round2(subtotalBase + taxAmount);
    } else {
        pphFinalAmount = round2(subtotalBase * (taxPercent / 100));
        netTotal = subtotalBase;
    }

    const grossTotal = round2(Number(plain?.total || 0));
    const returnTotal = round2(Math.max(0, grossTotal - netTotal));

    return {
        invoice_id: String(invoice.id),
        gross_total: grossTotal,
        net_total: netTotal,
        return_total: returnTotal,
        old_items_subtotal: oldItemsSubtotal,
        new_items_subtotal: newItemsSubtotal,
        old_discount_amount: oldDiscount,
        new_discount_amount: newDiscount,
        shipping_fee_total: effectiveShippingFeeTotal,
        tax_mode_snapshot: taxMode,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        pph_final_amount: pphFinalAmount,
        per_order_item_returned_qty: perOrderItemReturnedQty
    };
};

export const computeInvoiceNetTotalsBulk = async (
    invoiceIds: string[],
    options?: { transaction?: Transaction }
): Promise<Map<string, InvoiceNetTotals>> => {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(invoiceIds) ? invoiceIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));
    const result = new Map<string, InvoiceNetTotals>();
    if (normalizedIds.length === 0) return result;

    const invoices = await Invoice.findAll({
        where: { id: { [Op.in]: normalizedIds } },
        attributes: ['id', 'total', 'discount_amount', 'shipping_fee_total', 'tax_mode_snapshot', 'tax_percent'],
        transaction: options?.transaction
    });
    const invoiceById = new Map<string, any>();
    invoices.forEach((inv: any) => invoiceById.set(String(inv.id), inv.get({ plain: true })));

    const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: { [Op.in]: normalizedIds } },
        attributes: ['invoice_id', 'qty', 'unit_price', 'order_item_id'],
        include: [{
            model: OrderItem,
            required: true,
            attributes: ['id', 'order_id', 'product_id']
        }],
        transaction: options?.transaction
    });

    const itemsByInvoiceId = new Map<string, any[]>();
    const orderIds: string[] = [];
    invoiceItems.forEach((row: any) => {
        const invoiceId = String(row?.invoice_id || '').trim();
        if (!invoiceId) return;
        const list = itemsByInvoiceId.get(invoiceId) || [];
        list.push(row.get ? row.get({ plain: true }) : row);
        itemsByInvoiceId.set(invoiceId, list);

        const orderId = String(row?.OrderItem?.order_id || '').trim();
        if (orderId) orderIds.push(orderId);
    });

    const uniqueOrderIds = Array.from(new Set(orderIds));
    const returs = uniqueOrderIds.length > 0
        ? await Retur.findAll({
            where: {
                order_id: { [Op.in]: uniqueOrderIds },
                retur_type: { [Op.in]: ['delivery_refusal', 'delivery_damage'] },
                status: { [Op.ne]: 'rejected' }
            },
            attributes: ['id', 'order_id', 'product_id', 'qty', 'qty_received', 'status', 'retur_type'],
            transaction: options?.transaction
        })
        : [];

    const effectiveReturnByOrderProduct = new Map<string, number>();
    returs.forEach((retur: any) => {
        const orderId = String(retur?.order_id || '').trim();
        const productId = String(retur?.product_id || '').trim();
        if (!orderId || !productId) return;
        const key = `${orderId}:${productId}`;
        const eff = normalizeEffectiveReturQty(retur);
        effectiveReturnByOrderProduct.set(key, Number(effectiveReturnByOrderProduct.get(key) || 0) + eff);
    });

    for (const invoiceId of normalizedIds) {
        const plainInvoice = invoiceById.get(invoiceId);
        const items = itemsByInvoiceId.get(invoiceId) || [];

        const perOrderItemReturnedQty: PerOrderItemReturnedQty = {};
        const itemsByOrderProduct = new Map<string, any[]>();
        items.forEach((row: any) => {
            const orderId = String(row?.OrderItem?.order_id || '').trim();
            const productId = String(row?.OrderItem?.product_id || '').trim();
            const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
            if (!orderId || !productId || !orderItemId) return;
            const key = `${orderId}:${productId}`;
            const bucket = itemsByOrderProduct.get(key) || [];
            bucket.push(row);
            itemsByOrderProduct.set(key, bucket);
        });

        itemsByOrderProduct.forEach((bucket, key) => {
            let remaining = Math.max(0, Math.trunc(Number(effectiveReturnByOrderProduct.get(key) || 0)));
            if (remaining <= 0) return;
            const sorted = [...bucket].sort((a: any, b: any) => {
                const aId = String(a?.order_item_id || a?.OrderItem?.id || '');
                const bId = String(b?.order_item_id || b?.OrderItem?.id || '');
                const aNum = Number(aId);
                const bNum = Number(bId);
                if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
                return aId.localeCompare(bId);
            });
            for (const row of sorted) {
                if (remaining <= 0) break;
                const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
                if (!orderItemId) continue;
                const lineQty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
                if (lineQty <= 0) continue;
                const take = Math.max(0, Math.min(remaining, lineQty));
                remaining -= take;
                perOrderItemReturnedQty[orderItemId] = (perOrderItemReturnedQty[orderItemId] || 0) + take;
            }
        });

        let oldItemsSubtotal = 0;
        let newItemsSubtotal = 0;
        items.forEach((row: any) => {
            const orderItemId = String(row?.order_item_id || row?.OrderItem?.id || '').trim();
            const qty = Math.max(0, Math.trunc(Number(row?.qty || 0)));
            const unitPrice = Math.max(0, Number(row?.unit_price || 0));
            const returnedQty = Math.max(0, Math.min(qty, Math.trunc(Number(perOrderItemReturnedQty[orderItemId] || 0))));
            oldItemsSubtotal += round2(unitPrice * qty);
            newItemsSubtotal += round2(unitPrice * Math.max(0, qty - returnedQty));
        });
        oldItemsSubtotal = round2(oldItemsSubtotal);
        newItemsSubtotal = round2(newItemsSubtotal);

        const grossTotal = round2(Number(plainInvoice?.total || 0));
        const shippingFeeTotal = round2(Number(plainInvoice?.shipping_fee_total || 0));
        const oldDiscount = round2(Number(plainInvoice?.discount_amount || 0));
        const ratio = oldItemsSubtotal > 0 ? (newItemsSubtotal / oldItemsSubtotal) : 0;
        const newDiscount = round2(Math.min(newItemsSubtotal, Math.max(0, oldDiscount * ratio)));

        const subtotalBase = round2(Math.max(0, newItemsSubtotal - newDiscount + shippingFeeTotal));
        const taxMode = plainInvoice?.tax_mode_snapshot === 'pkp' ? 'pkp' : 'non_pkp';
        const taxPercent = Number(plainInvoice?.tax_percent || 0);
        let taxAmount = 0;
        let pphFinalAmount: number | null = null;
        let netTotal = subtotalBase;
        if (taxMode === 'pkp') {
            taxAmount = round2(subtotalBase * (taxPercent / 100));
            netTotal = round2(subtotalBase + taxAmount);
        } else {
            pphFinalAmount = round2(subtotalBase * (taxPercent / 100));
            netTotal = subtotalBase;
        }

        result.set(invoiceId, {
            invoice_id: invoiceId,
            gross_total: grossTotal,
            net_total: netTotal,
            return_total: round2(Math.max(0, grossTotal - netTotal)),
            old_items_subtotal: oldItemsSubtotal,
            new_items_subtotal: newItemsSubtotal,
            old_discount_amount: oldDiscount,
            new_discount_amount: newDiscount,
            shipping_fee_total: shippingFeeTotal,
            tax_mode_snapshot: taxMode,
            tax_percent: taxPercent,
            tax_amount: taxAmount,
            pph_final_amount: pphFinalAmount,
            per_order_item_returned_qty: perOrderItemReturnedQty
        });
    }

    return result;
};
